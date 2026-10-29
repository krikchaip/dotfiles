#!/usr/bin/env python3
"""Return to the last live tab or workspace without a background watcher.

Read native focus logs backward in 8 KiB chunks, at most 256 KiB per action.
History is shared by clients of one session. Missing or rotated history leaves
focus unchanged with a notification; the native log format is not a public API.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sys

CHUNK_BYTES = 8 * 1024
MAX_SCAN_BYTES = 256 * 1024
FOCUS = re.compile(
    rb'\bevent="(tab|workspace)\.focus"\s.*\bworkspace_id="([^"\r\n]+)"'
    rb'(?:\s+tab_id="([^"\r\n]+)")?(?:\s|$)'
)


def reverse_lines(stream):
    """Read complete log records, newest first, within a fixed I/O budget."""
    position = stream.seek(0, os.SEEK_END)
    lower = max(0, position - MAX_SCAN_BYTES)
    pending = b""
    skip_tail = True
    while position > lower:
        start = max(lower, position - CHUNK_BYTES)
        stream.seek(start)
        parts = (stream.read(position - start) + pending).split(b"\n")
        position = start
        pending = parts[0]
        for line in reversed(parts[1:]):
            # The newest fragment is empty or an unfinished log write.
            if skip_tail:
                skip_tail = False
            else:
                yield line
    if position == 0 and not skip_tail:
        yield pending


def previous_focus(stream, kind, current_id, live_ids, workspace_id=None):
    event_kind = kind.encode()
    workspace = workspace_id.encode() if workspace_id is not None else None
    current = current_id.encode()
    live = {item.encode() for item in live_ids}
    for line in reverse_lines(stream):
        match = FOCUS.search(line)
        if match is None or match[1] != event_kind:
            continue
        if workspace is not None and match[2] != workspace:
            continue
        target = match[3] if kind == "tab" else match[2]
        if target != current and target in live:
            return target.decode()
    return None


class Herdr:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def call(self, method, params=None):
        request = {"id": "dotfiles:navigation", "method": method, "params": params or {}}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(self.endpoint)
            client.sendall((json.dumps(request) + "\n").encode())
            with client.makefile("r", encoding="utf-8") as stream:
                response = json.loads(stream.readline())
        if "error" in response:
            raise RuntimeError(f"{method}: {response['error']}")
        return response["result"]

    def notify(self, title, body):
        self.call("notification.show", {"title": title, "body": body})


def focus_records(endpoint):
    """Share the bounded native history reader with lifecycle hooks."""
    with Path(endpoint).with_name("herdr-server.log").open("rb") as stream:
        return [match for line in reverse_lines(stream)
                if (match := FOCUS.search(line)) is not None]


def restore_closed_tab(herdr, event):
    """Ignore native fallback focus, but never override a later logged visit."""
    workspace_id = event["data"]["workspace_id"]
    records = focus_records(herdr.endpoint)
    latest = next((record for record in records
                   if record[1] == b"tab" and record[2].decode() == workspace_id), None)
    if latest is None:
        return
    closed = latest[3].decode()
    if event["event"] == "tab_closed" and closed != event["data"]["tab_id"]:
        return
    snapshot = herdr.call("session.snapshot")["snapshot"]
    live = {tab["tab_id"] for tab in snapshot["tabs"]
            if tab["workspace_id"] == workspace_id}
    if closed in live or snapshot["focused_workspace_id"] != workspace_id:
        return
    target = next((record[3].decode() for record in records
                   if record[1] == b"tab" and record[2].decode() == workspace_id
                   and record[3].decode() in live), None)
    if target is None or snapshot["focused_tab_id"] == target:
        return
    # Commands are asynchronous: a newer explicit visit invalidates this hook.
    newest = focus_records(herdr.endpoint)
    if not newest or newest[0].string != records[0].string:
        return
    herdr.call("tab.focus", {"tab_id": target})


def recent_sibling(herdr, snapshot, tab_id):
    """Return the most recently visited live tab beside tab_id in its workspace."""
    workspace_id = next(tab["workspace_id"] for tab in snapshot["tabs"] if tab["tab_id"] == tab_id)
    live = {tab["tab_id"] for tab in snapshot["tabs"]
            if tab["workspace_id"] == workspace_id and tab["tab_id"] != tab_id}
    if not live:
        return None
    try:
        with Path(herdr.endpoint).with_name("herdr-server.log").open("rb") as stream:
            return previous_focus(stream, "tab", tab_id, live, workspace_id)
    except FileNotFoundError:
        return None


def leave_tab(herdr, snapshot, tab_id):
    """Focus the recent sibling first, so Herdr never draws its neighbor fallback."""
    if snapshot["focused_tab_id"] != tab_id:
        return
    target = recent_sibling(herdr, snapshot, tab_id)
    if target is not None:
        herdr.call("tab.focus", {"tab_id": target})


def new_tab(herdr, workspace_id):
    """Open a tab right of the active one with its pane's CWD, like tmux new-window -a."""
    snapshot = herdr.call("session.snapshot")["snapshot"]
    # Read the active tab under the lock: a rapid second press then follows
    # the first new tab rather than the tab both keypresses started from.
    source_id = next(item["active_tab_id"] for item in snapshot["workspaces"]
                     if item["workspace_id"] == workspace_id)
    tabs = [tab["tab_id"] for tab in snapshot["tabs"] if tab["workspace_id"] == workspace_id]
    layout = next((item for item in snapshot["layouts"] if item["tab_id"] == source_id), {})
    pane = next((item for item in snapshot["panes"]
                 if item["pane_id"] == layout.get("focused_pane_id")), {})
    params = {"workspace_id": workspace_id, "focus": True}
    if pane.get("foreground_cwd") or pane.get("cwd"):
        params["cwd"] = pane.get("foreground_cwd") or pane.get("cwd")
    # Herdr draws an unfocused creation at the end of the bar at once, but
    # draws a focused one only after its shell starts. Move it before then.
    created = herdr.call("tab.create", params)["tab"]["tab_id"]
    insert_index = tabs.index(source_id) + 1
    if insert_index < len(tabs):
        herdr.call("tab.move", {"tab_id": created, "insert_index": insert_index})


def place_created_tab(herdr, event):
    """Move a tab from another surface (mouse, API, pane move) beside its source.

    The new-tab action places its own tab before Herdr draws it. Other surfaces
    append, so this hook can only correct them after one drawn frame.
    """
    created = event["data"]["tab"]
    target, workspace_id = created["tab_id"], created["workspace_id"]
    snapshot = herdr.call("session.snapshot")["snapshot"]
    tabs = [tab["tab_id"] for tab in snapshot["tabs"] if tab["workspace_id"] == workspace_id]
    if len(tabs) < 2 or tabs[-1] != target:
        return
    source = recent_sibling(herdr, snapshot, target)
    if source is not None and tabs.index(source) != len(tabs) - 2:
        herdr.call("tab.move", {"tab_id": target, "insert_index": tabs.index(source) + 1})


def close_pane(herdr, pane_id):
    """Close a pane; when it is the last pane, leave its tab like tab close does."""
    snapshot = herdr.call("session.snapshot")["snapshot"]
    pane = next(item for item in snapshot["panes"] if item["pane_id"] == pane_id)
    tab = next(item for item in snapshot["tabs"] if item["tab_id"] == pane["tab_id"])
    if tab["pane_count"] == 1:
        leave_tab(herdr, snapshot, tab["tab_id"])
    herdr.call("pane.close", {"pane_id": pane_id})


def open_close_dialog(herdr, tab_id):
    """Open the prompt at Herdr's native size; Herdr pins it to the invoking pane."""
    herdr.call("plugin.pane.open", {
        "plugin_id": "dotfiles.navigation", "entrypoint": "close-tab",
        "placement": "popup", "env": {"NAV_CLOSE_TAB_ID": tab_id},
    })


def confirm_close_tab(herdr):
    from confirm_ui import confirm

    target = os.environ["NAV_CLOSE_TAB_ID"]
    snapshot = herdr.call("session.snapshot")["snapshot"]
    tab = next((item for item in snapshot["tabs"] if item["tab_id"] == target), None)
    if tab is None:
        return
    count = tab["pane_count"]
    detail = f'{tab.get("label") or target} — {count} {"pane" if count == 1 else "panes"}'
    if not confirm("Close tab?", detail, "confirm"):
        return
    # A tab may exit or move while its confirmation is on screen.
    snapshot = herdr.call("session.snapshot")["snapshot"]
    if any(item["tab_id"] == target for item in snapshot["tabs"]):
        leave_tab(herdr, snapshot, target)
        herdr.call("tab.close", {"tab_id": target})


def main():
    action = sys.argv[1]
    if action in ("closed", "created", "new-tab", "close-pane", "close-tab", "confirm-close-tab"):
        herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
        context = json.loads(os.environ.get("HERDR_PLUGIN_CONTEXT_JSON") or "{}")
        if action == "closed":
            restore_closed_tab(herdr, json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"]))
        elif action == "confirm-close-tab":
            confirm_close_tab(herdr)
        elif action == "close-tab":
            open_close_dialog(herdr, context.get("tab_id") or os.environ["HERDR_TAB_ID"])
        else:
            state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
            key = hashlib.sha256(herdr.endpoint.encode()).hexdigest()[:16]
            # Serialize rapid keypresses so each one reads the previous result.
            with (state_dir / f"{key}.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if action == "created":
                    place_created_tab(herdr, json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"]))
                elif action == "new-tab":
                    new_tab(herdr, context.get("workspace_id") or os.environ["HERDR_WORKSPACE_ID"])
                else:
                    close_pane(herdr, context.get("pane_id") or os.environ["HERDR_PANE_ID"])
        return
    if action not in ("last-tab", "last-workspace"):
        raise ValueError(f"unknown navigation action: {action}")
    kind = "tab" if action == "last-tab" else "workspace"
    title = f"Last {kind}"
    endpoint = os.environ["HERDR_SOCKET_PATH"]
    herdr = Herdr(endpoint)
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    key = hashlib.sha256(endpoint.encode()).hexdigest()[:16]
    # Serialize rapid keypresses, including the authoritative read and focus.
    with (state_dir / f"{key}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        snapshot = herdr.call("session.snapshot")["snapshot"]
        workspace_id = None
        if kind == "tab":
            workspace_id = os.environ.get("HERDR_WORKSPACE_ID") or snapshot["focused_workspace_id"]
            workspace = next((item for item in snapshot["workspaces"]
                              if item["workspace_id"] == workspace_id), None)
            if workspace is None:
                herdr.notify(title, "No active workspace.")
                return
            current = workspace["active_tab_id"]
            live = {tab["tab_id"] for tab in snapshot["tabs"]
                    if tab["workspace_id"] == workspace_id}
        else:
            current = snapshot["focused_workspace_id"]
            live = {workspace["workspace_id"] for workspace in snapshot["workspaces"]}
        if current is None:
            herdr.notify(title, "No active workspace.")
            return
        if len(live) < 2:
            herdr.notify(title, f"Only one open {kind}.")
            return
        # Default and named sessions keep the server log beside their API socket.
        log_path = Path(endpoint).with_name("herdr-server.log")
        try:
            with log_path.open("rb") as stream:
                target = previous_focus(stream, kind, current, live, workspace_id)
        except FileNotFoundError:
            herdr.notify(title, "Server focus log not found beside the Herdr socket.")
            return
        if target is None:
            herdr.notify(title, f"No previous open {kind} in the newest 256 KiB of focus history.")
            return
        herdr.call(f"{kind}.focus", {f"{kind}_id": target})
        print(f"Focused {target}")


if __name__ == "__main__":
    main()
