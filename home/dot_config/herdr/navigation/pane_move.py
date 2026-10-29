"""Move one live terminal with a durable popup-to-worker handoff.

Only pane.move changes layout. Stable terminal identities reconcile a lost reply
without substituting a different source or split anchor.
"""

from contextlib import contextmanager
import os
from pathlib import Path
import sys
import time

import tab_move


@contextmanager
def _locked(herdr, state_dir):
    with tab_move._locked(herdr, state_dir, allow_pane_move=True) as tab_path:
        if tab_path.exists():
            raise RuntimeError("A tab move is pending. Finish it before moving a pane.")
        key = tab_path.name.removesuffix(".move.json")
        yield tab_path.with_name(f"{key}.pane-move.json")


def pending_move(herdr, state_dir):
    with _locked(herdr, state_dir) as path:
        return tab_move._load(path, herdr)


def _snapshot(herdr):
    return herdr.call("session.snapshot")["snapshot"]


def _terminal(snapshot, terminal_id):
    return next((pane for pane in snapshot["panes"]
                 if pane["terminal_id"] == terminal_id), None)


def _layout(snapshot, tab_id):
    return next((layout for layout in snapshot["layouts"]
                 if layout["tab_id"] == tab_id), None)


def _zoom_state(snapshot, tab_id):
    layout = _layout(snapshot, tab_id)
    if layout is None:
        raise RuntimeError("A selected tab no longer exists. Nothing was moved.")
    focused = next((pane for pane in snapshot["panes"]
                    if pane["tab_id"] == tab_id
                    and pane["pane_id"] == layout["focused_pane_id"]), None)
    if focused is None:
        raise RuntimeError("The selected tab's focused pane disappeared. Open the picker again.")
    return {"tab_id": tab_id, "zoomed": layout["zoomed"],
            "focused_terminal_id": focused["terminal_id"]}


def _prepare(herdr, source_terminal_id, source_tab_id, destination):
    snapshot = _snapshot(herdr)
    source = _terminal(snapshot, source_terminal_id)
    if source is None or source["tab_id"] != source_tab_id:
        raise RuntimeError("The selected source pane closed or moved. Open the picker again.")
    destination = dict(destination)
    kind = destination.get("type")
    target_terminal_id = None
    if kind == "tab":
        if destination.get("tab_id") == source_tab_id:
            raise ValueError("Choose a different tab. The current tab cannot be a destination.")
        if destination.get("split") not in ("right", "down"):
            raise ValueError("Choose a right or down split.")
        target_state = _zoom_state(snapshot, destination.get("tab_id"))
        target_id = destination.get("target_pane_id") or _layout(
            snapshot, destination["tab_id"])["focused_pane_id"]
        target = next((pane for pane in snapshot["panes"]
                       if pane["pane_id"] == target_id
                       and pane["tab_id"] == destination["tab_id"]), None)
        if target is None:
            raise RuntimeError("The chosen split anchor closed or moved. Open the picker again.")
        target_terminal_id = target["terminal_id"]
        destination["target_pane_id"] = target["pane_id"]
        allowed = {"type", "tab_id", "target_pane_id", "split", "ratio"}
    elif kind == "new_tab":
        if not any(workspace["workspace_id"] == destination.get("workspace_id")
                   for workspace in snapshot["workspaces"]):
            raise RuntimeError("The destination workspace no longer exists. Nothing was moved.")
        allowed = {"type", "workspace_id", "label"}
        target_state = None
    elif kind == "new_workspace":
        if "label" in destination:
            destination["label"] = destination["label"].strip()
            if not destination["label"]:
                raise ValueError("A new workspace needs a name.")
        allowed = {"type", "label", "tab_label"}
        target_state = None
    else:
        raise ValueError("Choose a tab, workspace, or new workspace destination.")
    if destination.keys() - allowed:
        raise ValueError("The pane move destination contains unsupported fields.")
    return {
        "version": 1, "endpoint": herdr.endpoint,
        "source_terminal_id": source_terminal_id, "source_tab_id": source_tab_id,
        "label": source.get("title") or source.get("label") or source["pane_id"],
        "destination": destination, "target_terminal_id": target_terminal_id,
        "source_zoom": _zoom_state(snapshot, source_tab_id), "target_zoom": target_state,
        "initial_tabs": [tab["tab_id"] for tab in snapshot["tabs"]],
        "initial_workspaces": [workspace["workspace_id"] for workspace in snapshot["workspaces"]],
        "phase": "prepared",
    }


def request_move(herdr, state_dir, source_terminal_id, source_tab_id, *,
                 destination, dialog_pid):
    with _locked(herdr, state_dir) as path:
        if tab_move._load(path, herdr) is not None:
            raise RuntimeError("A pane move is pending. Resume it before starting another.")
        plan = _prepare(herdr, source_terminal_id, source_tab_id, destination)
        plan["dialog_pid"] = dialog_pid
        tab_move._save(path, plan)
    herdr.call("plugin.action.invoke", {"action_id": "dotfiles.navigation.finish-move"})


def request_resume(herdr, state_dir, *, dialog_pid):
    with _locked(herdr, state_dir) as path:
        plan = tab_move._load(path, herdr)
        if plan is None:
            raise RuntimeError("There is no interrupted pane move to resume.")
        plan["dialog_pid"] = dialog_pid
        tab_move._save(path, plan)
    herdr.call("plugin.action.invoke", {"action_id": "dotfiles.navigation.finish-move"})


def _at_destination(snapshot, plan, source):
    destination = plan["destination"]
    if source["tab_id"] == plan["source_tab_id"]:
        return False
    if plan.get("moved_tab_id") is not None:
        return source["tab_id"] == plan["moved_tab_id"]
    if destination["type"] == "tab":
        target = _terminal(snapshot, plan["target_terminal_id"])
        return (source["tab_id"] == destination["tab_id"] and target is not None
                and target["tab_id"] == destination["tab_id"])
    if source["tab_id"] in plan["initial_tabs"]:
        return False
    if destination["type"] == "new_tab":
        return source["workspace_id"] == destination["workspace_id"]
    if source["workspace_id"] in plan["initial_workspaces"]:
        return False
    return any(workspace["workspace_id"] == source["workspace_id"]
               and ("label" not in destination or workspace["label"] == destination["label"])
               for workspace in snapshot["workspaces"])


def _set_zoom(herdr, snapshot, state, *, surviving=False):
    if state is None:
        return
    layout = _layout(snapshot, state["tab_id"])
    if layout is None:
        return
    panes = [pane for pane in snapshot["panes"] if pane["tab_id"] == state["tab_id"]]
    if surviving and len(panes) < 2:
        return
    focused = _terminal(snapshot, state["focused_terminal_id"])
    if focused is None or focused["tab_id"] != state["tab_id"]:
        focused = next((pane for pane in panes
                        if pane["pane_id"] == layout["focused_pane_id"]), None)
    if focused is not None and layout["zoomed"] != state["zoomed"]:
        herdr.call("pane.zoom", {"pane_id": focused["pane_id"],
                                 "mode": "on" if state["zoomed"] else "off"})


def _unzoom(herdr, snapshot, tab_id):
    layout = _layout(snapshot, tab_id)
    if layout is None:
        raise RuntimeError("A selected tab disappeared. Nothing was moved.")
    if layout["zoomed"]:
        herdr.call("pane.zoom", {"pane_id": layout["focused_pane_id"], "mode": "off"})


def _finish(herdr, path, plan, snapshot, source):
    plan["phase"] = "moved"
    plan["moved_tab_id"] = source["tab_id"]
    tab_move._save(path, plan)
    # A successful split must stay visible, even if its target was zoomed.
    _unzoom(herdr, snapshot, source["tab_id"])
    _set_zoom(herdr, snapshot, plan["source_zoom"], surviving=True)
    # pane.move focus alone does not switch attached TUI clients.
    herdr.call("pane.focus", {"pane_id": source["pane_id"]})
    path.unlink()
    tab_move._sync_directory(path.parent)
    return {"target_tab_id": source["tab_id"], "target_workspace_id": source["workspace_id"]}


def _run(herdr, path, plan):
    snapshot = _snapshot(herdr)
    source = _terminal(snapshot, plan["source_terminal_id"])
    if source is None:
        raise RuntimeError("The source terminal closed. No other pane will be moved.")
    if plan["phase"] != "prepared" and _at_destination(snapshot, plan, source):
        return _finish(herdr, path, plan, snapshot, source)
    if plan["phase"] == "moved":
        raise RuntimeError("The moved terminal changed tabs again. The completed move will not be replayed.")
    if source["tab_id"] != plan["source_tab_id"]:
        raise RuntimeError("The source terminal moved elsewhere. No other pane will be moved.")
    destination = dict(plan["destination"])
    if destination["type"] == "tab":
        if destination["tab_id"] == source["tab_id"]:
            raise ValueError("Choose a different tab. Nothing was moved.")
        target = _terminal(snapshot, plan["target_terminal_id"])
        if target is None or target["tab_id"] != destination["tab_id"]:
            raise RuntimeError("The chosen split anchor closed or moved. No other pane will be used.")
        destination["target_pane_id"] = target["pane_id"]
    elif destination["type"] == "new_tab" and not any(
            workspace["workspace_id"] == destination["workspace_id"]
            for workspace in snapshot["workspaces"]):
        raise RuntimeError("The destination workspace closed. Nothing was moved.")
    if plan["phase"] == "prepared":
        # Capture the state actually changed by the worker, after its popup exits.
        plan["source_zoom"] = _zoom_state(snapshot, source["tab_id"])
        if destination["type"] == "tab":
            plan["target_zoom"] = _zoom_state(snapshot, destination["tab_id"])
        plan["phase"] = "moving"
        tab_move._save(path, plan)
    _unzoom(herdr, snapshot, source["tab_id"])
    if destination["type"] == "tab":
        _unzoom(herdr, snapshot, destination["tab_id"])
    result = herdr.call("pane.move", {"pane_id": source["pane_id"],
                                      "destination": destination, "focus": False})["move_result"]
    if not result["changed"]:
        raise RuntimeError(f"Herdr refused the pane move: {result.get('reason', 'unchanged')}")
    snapshot = _snapshot(herdr)
    source = _terminal(snapshot, plan["source_terminal_id"])
    if source is None or not _at_destination(snapshot, plan, source):
        raise RuntimeError("The moved terminal is not at its planned destination. Move paused.")
    return _finish(herdr, path, plan, snapshot, source)


def _execute(herdr, path, plan):
    try:
        return _run(herdr, path, plan)
    except BaseException:
        # A lost reply may mean success. Never restore target zoom over a moved
        # pane, or delete the journal unless a fresh snapshot proves no move.
        try:
            snapshot = _snapshot(herdr)
            source = _terminal(snapshot, plan["source_terminal_id"])
            if source is None:
                # A closed terminal cannot be resumed. Do not block future moves.
                if plan["phase"] == "moving":
                    _set_zoom(herdr, snapshot, plan["source_zoom"], surviving=True)
                    _set_zoom(herdr, snapshot, plan["target_zoom"])
                path.unlink()
                tab_move._sync_directory(path.parent)
            elif source["tab_id"] == plan["source_tab_id"] and plan["phase"] != "moved":
                _set_zoom(herdr, snapshot, plan["source_zoom"])
                _set_zoom(herdr, snapshot, plan["target_zoom"])
                path.unlink()
                tab_move._sync_directory(path.parent)
            elif source is not None and _at_destination(snapshot, plan, source):
                plan["phase"] = "moved"
                plan["moved_tab_id"] = source["tab_id"]
                tab_move._save(path, plan)
                _set_zoom(herdr, snapshot, plan["source_zoom"], surviving=True)
        except Exception:
            pass  # Preserve recovery information if the live state is uncertain.
        raise


def _wait_for_dialog(plan):
    dialog_pid = plan.get("dialog_pid")
    if dialog_pid is None:
        return
    deadline = time.monotonic() + 5
    while True:
        try:
            os.kill(dialog_pid, 0)
        except ProcessLookupError:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("Close the move dialog before resuming the pane transfer.")
        time.sleep(0.02)


def main():
    from navigation import Herdr

    herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    try:
        with _locked(herdr, state_dir) as path:
            plan = tab_move._load(path, herdr)
            if plan is None:
                return
            # Hold the session lock while waiting: no second worker can execute
            # this plan or navigate away between the authoritative read and move.
            _wait_for_dialog(plan)
            result = _execute(herdr, path, plan)
        herdr.notify("Move pane", f"Moved {plan['label']}.")
        print(f"Moved pane to {result['target_tab_id']}")
    except Exception as error:
        print(f"Pane move failed: {error}", file=sys.stderr)
        try:
            pending = pending_move(herdr, state_dir)
            advice = " Reopen the pane move shortcut to resume." if pending else ""
            herdr.notify("Move pane paused", f"{error}{advice}")
        except Exception:
            pass  # The stderr log still records failure if notification fails.
        raise
