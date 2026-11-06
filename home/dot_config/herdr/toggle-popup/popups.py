"""Popup state: the record of each popup, and cleanup of popups that are stale.

Each popup is one workspace in the popup session, labelled with the popup id.
A small JSON record per popup in the plugin state folder keeps what the
plugin must remember about it: its scope, label, terminal, command, toggle
keys, and owner. The popup session is the truth for which popups exist; a
record only counts while a workspace with the same label runs the same
terminal.
"""

import contextlib
import enum
import fcntl
import hashlib
import json
import os
import shlex
from dataclasses import asdict, dataclass

from herdr_api import Herdr, HerdrError, log_error, plugin_state_dir

# How long to wait for an owner session's snapshot. A toggle key must feel
# instant, so it waits only briefly; hooks run in the background.
TOGGLE_OWNER_TIMEOUT = 0.25
HOOK_OWNER_TIMEOUT = 2.0


def program_text(command, default_shell=None):
    """The text of a popup's program: its command, or the default shell
    without one. That is `default_shell` (the main config's default_shell),
    else "shell". The label, the toasts and the picker all use it.
    """
    if command:
        return shlex.join(command)
    return default_shell or "shell"


class OwnerSession(enum.Enum):
    """An owner session that gave no snapshot."""

    GONE = "gone"  # No server owns its socket: its popups close.
    NO_ANSWER = "no answer"  # Its server did not answer in time: its popups stay.


@dataclass(frozen=True)
class Scope:
    """Where a popup is shared.

    `owner_env` gives each Owner field of the scope with the Herdr
    environment value that it comes from (see toggle_popup.popup_owner()).
    The owner socket is always HERDR_SOCKET_PATH. With `session_group`, the
    picker lists the popup under the session name, not under a workspace.
    """

    owner_env: tuple[tuple[str, str], ...]
    session_group: bool


SCOPES = {
    "tab": Scope((("workspace_id", "HERDR_ACTIVE_WORKSPACE_ID"),
                  ("tab_id", "HERDR_ACTIVE_TAB_ID")), session_group=False),
    "workspace": Scope((("workspace_id", "HERDR_ACTIVE_WORKSPACE_ID"),), session_group=False),
    "pwd": Scope((("folder", "HERDR_ACTIVE_PANE_CWD"),), session_group=True),
    "session": Scope((), session_group=True),
}


@dataclass
class Owner:
    """What a popup belongs to: a Herdr session (its socket) and its scope value.

    A tab popup has the tab and the workspace of that tab, a workspace popup
    has the workspace, and a pwd popup has the folder. A tab id names its
    workspace too (`w1:t2`), so a tab never moves to another workspace.
    """

    socket: str
    workspace_id: str | None = None
    tab_id: str | None = None
    folder: str | None = None


@dataclass
class PopupRecord:
    id: str
    scope: str
    label: str
    terminal_id: str
    command: list[str] | None
    toggle_keys: list[str]
    owner: Owner

    @classmethod
    def from_json(cls, data):
        """A record from its JSON data. Raise ValueError or TypeError for bad data."""
        record = cls(**dict(data, owner=Owner(**data["owner"])))
        if record.scope not in SCOPES:
            raise ValueError(f"unknown scope: {record.scope}")
        return record


@contextlib.contextmanager
def popup_lock():
    """Serialize changes to the popup session across key presses and hooks."""
    with (plugin_state_dir() / "popups.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def record_path(popup_id):
    digest = hashlib.sha256(popup_id.encode()).hexdigest()[:32]
    return plugin_state_dir() / "popups" / f"{digest}.json"


def _read_record(path):
    """Read one record file. Remove a broken one and return None."""
    try:
        return PopupRecord.from_json(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return None
    except (ValueError, KeyError, TypeError, AttributeError):
        path.unlink(missing_ok=True)
        return None


def load_record(popup_id):
    return _read_record(record_path(popup_id))


def save_record(record):
    path = record_path(record.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(asdict(record), indent=2), encoding="utf-8")
    os.replace(temporary, path)


def delete_record(popup_id):
    record_path(popup_id).unlink(missing_ok=True)


def all_records():
    folder = plugin_state_dir() / "popups"
    paths = sorted(folder.glob("*.json")) if folder.is_dir() else []
    return [record for record in map(_read_record, paths) if record is not None]


@dataclass(frozen=True)
class LivePopup:
    """A popup that runs: its backing pane (from the snapshot) and its record."""

    pane: dict
    record: PopupRecord

    @property
    def workspace_id(self):
        return self.pane["workspace_id"]


def live_popups(snapshot):
    """Map popup id to a LivePopup for each popup workspace in the snapshot.

    A workspace counts only when its record names the same terminal. A
    workspace that Herdr restored after a restart runs a new terminal, so it
    is stale.
    """
    panes = {}
    for pane in snapshot["panes"]:
        panes.setdefault(pane["workspace_id"], pane)
    live = {}
    for workspace in snapshot["workspaces"]:
        pane = panes.get(workspace["workspace_id"])
        record = load_record(workspace["label"])
        if pane is None or record is None or record.terminal_id != pane["terminal_id"]:
            continue
        live[workspace["label"]] = LivePopup(pane, record)
    return live


def close_popup(herdr, workspace_id, popup_id=None):
    """Close a popup workspace. A workspace that is gone already is no error."""
    try:
        herdr.call("workspace.close", {"workspace_id": workspace_id})
    except HerdrError as error:
        if error.code != "workspace_not_found":
            raise
    if popup_id is not None:
        delete_record(popup_id)


@dataclass
class OwnerIds:
    """The workspace ids and tab ids of a live owner session."""

    workspaces: set[str]
    tabs: set[str]


def _owner_session(socket, timeout):
    """The ids of a live owner session (OwnerIds), or an OwnerSession state."""
    try:
        snapshot = Herdr(socket, timeout=timeout).snapshot()
    except HerdrError as error:
        return OwnerSession.GONE if error.code == "gone" else OwnerSession.NO_ANSWER
    return OwnerIds({item["workspace_id"] for item in snapshot["workspaces"]},
                    {item["tab_id"] for item in snapshot["tabs"]})


def stale_owner(record, owners, timeout=HOOK_OWNER_TIMEOUT):
    """True when a popup's owner session, owner workspace, or owner tab no longer exists.

    An owner session is gone only when its socket is missing or refuses: Herdr
    restores workspaces with their ids, so a restarted session keeps its
    popups, and a server that does not answer in time keeps them too.
    `owners` caches the answer of each owner socket for a single sweep.
    """
    owner = record.owner
    if owner.socket not in owners:
        owners[owner.socket] = _owner_session(owner.socket, timeout)
    session = owners[owner.socket]
    if session is OwnerSession.NO_ANSWER:
        return False
    if session is OwnerSession.GONE:
        return True
    if owner.tab_id is not None:
        return owner.tab_id not in session.tabs
    return owner.workspace_id is not None and owner.workspace_id not in session.workspaces


def close_owned(herdr, socket, workspace_id=None, tab_id=None):
    """Close the popups of a tab, or of a workspace and its tabs, in the session at `socket`.

    Herdr sends no tab.closed for the tabs of a closed workspace, so a
    workspace closes its tab popups too.
    """
    for popup_id, popup in live_popups(herdr.snapshot()).items():
        owner = popup.record.owner
        if owner.socket != socket:
            continue
        if (tab_id is not None and owner.tab_id == tab_id) or (
                workspace_id is not None and owner.workspace_id == workspace_id):
            close_popup(herdr, popup.workspace_id, popup_id)


def housekeeping_sweep(herdr):
    """sweep() for a key press. The toggle runs it in the background when the
    popup shows its program (see toggle_popup.sweep_in_background()), and
    the picker runs it before it lists the popups.

    A missed close hook can leave popups whose owner is gone. That is
    housekeeping: its error goes only to the log, and the key press goes on.
    OSError and ValueError come from the state folder and its record files.
    """
    try:
        sweep(herdr, TOGGLE_OWNER_TIMEOUT)
    except (HerdrError, OSError, ValueError) as error:
        log_error("sweep", error)


def sweep(herdr, owner_timeout=HOOK_OWNER_TIMEOUT):
    """Close stale popup workspaces and popups whose owner is gone. Drop orphan records.

    `owner_timeout` is the wait for each owner session: TOGGLE_OWNER_TIMEOUT
    on the toggle path, HOOK_OWNER_TIMEOUT in hooks.
    """
    snapshot = herdr.snapshot()
    live = live_popups(snapshot)
    owners = {}
    for workspace in snapshot["workspaces"]:
        popup_id = workspace["label"]
        popup = live.get(popup_id)
        if popup is None or popup.workspace_id != workspace["workspace_id"]:
            close_popup(herdr, workspace["workspace_id"])
            continue
        if stale_owner(popup.record, owners, owner_timeout):
            close_popup(herdr, workspace["workspace_id"], popup_id)
    for record in all_records():
        if record.id not in live:
            delete_record(record.id)
