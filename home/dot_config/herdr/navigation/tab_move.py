"""Move a live split tab; resume interrupted transfers without restarting panes.

A durable plan records stable terminal IDs before the first move. Recovery
reconciles those IDs against Herdr instead of replaying an uncertain request.
No layout.apply call is used: it would replace live terminal processes.
"""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time


def _paths(herdr, state_dir):
    key = hashlib.sha256(herdr.endpoint.encode()).hexdigest()[:16]
    return state_dir / f"{key}.lock", state_dir / f"{key}.move.json"


@contextmanager
def _locked(herdr, state_dir):
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    lock_path, journal_path = _paths(herdr, state_dir)
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield journal_path


def _sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _save(path, plan):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(plan, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    _sync_directory(path.parent)


def _load(path, herdr):
    if not path.exists():
        return None
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("version") != 1 or plan.get("endpoint") != herdr.endpoint:
        raise RuntimeError("The pending move journal does not match this Herdr session.")
    return plan


def pending_move(herdr, state_dir):
    with _locked(herdr, state_dir) as path:
        return _load(path, herdr)


def _leaves(node):
    if node["type"] == "pane":
        return [node["pane_id"]]
    return _leaves(node["first"]) + _leaves(node["second"])


def _shape(node, identities, present):
    if node["type"] == "pane":
        identity = identities[node["pane_id"]]
        return ("pane", identity) if identity in present else None
    first = _shape(node["first"], identities, present)
    second = _shape(node["second"], identities, present)
    if first is None:
        return second
    if second is None:
        return first
    return (node["direction"], round(node["ratio"], 6), first, second)


def _steps(node, identities):
    if node["type"] == "pane":
        return
    yield (identities[_leaves(node["first"])[0]],
           identities[_leaves(node["second"])[0]], node["direction"], node["ratio"])
    yield from _steps(node["first"], identities)
    yield from _steps(node["second"], identities)


def _snapshot(herdr):
    return herdr.call("session.snapshot")["snapshot"]


def _locations(snapshot, plan):
    terminals = set(plan["terminals"].values())
    found = {pane["terminal_id"]: pane for pane in snapshot["panes"]
             if pane["terminal_id"] in terminals}
    if set(found) != terminals:
        raise RuntimeError("A pane disappeared. Move paused; surviving panes were left running.")
    return found


def _check_tab(herdr, snapshot, plan, tab_id, locations):
    panes = [pane for pane in snapshot["panes"] if pane["tab_id"] == tab_id]
    identities = {pane["pane_id"]: pane["terminal_id"] for pane in panes}
    expected = {terminal for terminal, pane in locations.items() if pane["tab_id"] == tab_id}
    if set(identities.values()) != expected:
        raise RuntimeError("Another pane was added to a moving tab. Move paused.")
    layout = herdr.call("layout.export", {"tab_id": tab_id})["layout"]
    actual = _shape(layout["root"], identities, expected)
    desired = _shape(plan["root"], plan["terminals"], expected)
    if actual != desired:
        raise RuntimeError("A moving tab's split layout changed. Restore it before resuming.")
    return layout


def _validate_locations(herdr, snapshot, plan, locations, target_tab):
    allowed = {plan["source_tab_id"], target_tab}
    if any(pane["tab_id"] not in allowed for pane in locations.values()):
        raise RuntimeError("A pane was moved elsewhere. Move paused without moving other panes.")
    for tab_id in {pane["tab_id"] for pane in locations.values()}:
        _check_tab(herdr, snapshot, plan, tab_id, locations)


def _run(herdr, path, plan):
    snapshot = _snapshot(herdr)
    locations = _locations(snapshot, plan)
    first_terminal = plan["terminals"][_leaves(plan["root"])[0]]
    first = locations[first_terminal]
    source_tab = plan["source_tab_id"]
    destination = plan["destination"]

    if first["tab_id"] == source_tab:
        if any(pane["tab_id"] != source_tab for pane in locations.values()):
            raise RuntimeError("The move's first pane returned to the source. Move paused.")
        source = _check_tab(herdr, snapshot, plan, source_tab, locations)
        if "workspace_id" in destination:
            if not any(item["workspace_id"] == destination["workspace_id"]
                       for item in snapshot["workspaces"]):
                raise RuntimeError("The destination workspace no longer exists. Nothing else was moved.")
            target = {"type": "new_tab", "workspace_id": destination["workspace_id"],
                      "label": plan["label"]}
        else:
            target = {"type": "new_workspace", "label": destination["workspace_name"],
                      "tab_label": plan["label"]}
        if source["zoomed"]:
            herdr.call("pane.zoom", {"pane_id": source["focused_pane_id"], "mode": "off"})
        moved = herdr.call("pane.move", {"pane_id": first["pane_id"],
                                        "destination": target, "focus": False})["move_result"]
        if not moved["changed"]:
            raise RuntimeError(f"Herdr refused the move: {moved.get('reason', 'unchanged')}")
        snapshot = _snapshot(herdr)
        locations = _locations(snapshot, plan)
        first = locations[first_terminal]

    target_tab = first["tab_id"]
    target_workspace = first["workspace_id"]
    if "workspace_id" in destination:
        valid_destination = target_workspace == destination["workspace_id"]
    else:
        valid_destination = target_workspace not in plan["initial_workspaces"] and any(
            workspace["workspace_id"] == target_workspace
            and workspace["label"] == destination["workspace_name"]
            for workspace in snapshot["workspaces"])
    if not valid_destination or target_tab == source_tab:
        raise RuntimeError("The first pane is not at the planned destination. Move paused.")

    _validate_locations(herdr, snapshot, plan, locations, target_tab)
    for left, right, direction, ratio in _steps(plan["root"], plan["terminals"]):
        snapshot = _snapshot(herdr)
        locations = _locations(snapshot, plan)
        _validate_locations(herdr, snapshot, plan, locations, target_tab)
        if locations[right]["tab_id"] == target_tab:
            continue
        if locations[left]["tab_id"] != target_tab:
            raise RuntimeError("The destination split anchor is missing. Move paused.")
        moved = herdr.call("pane.move", {
            "pane_id": locations[right]["pane_id"], "focus": False,
            "destination": {"type": "tab", "tab_id": target_tab,
                            "target_pane_id": locations[left]["pane_id"],
                            "split": direction, "ratio": ratio},
        })["move_result"]
        if not moved["changed"]:
            raise RuntimeError(f"Herdr refused a pane move: {moved.get('reason', 'unchanged')}")

    snapshot = _snapshot(herdr)
    locations = _locations(snapshot, plan)
    if any(pane["tab_id"] != target_tab for pane in locations.values()):
        raise RuntimeError("Some panes are still outside the destination. Move paused.")
    _check_tab(herdr, snapshot, plan, target_tab, locations)
    focused = locations[plan["focused_terminal_id"]]["pane_id"]
    herdr.call("pane.zoom", {"pane_id": focused, "mode": "on" if plan["zoomed"] else "off"})
    # Changing server focus through pane.zoom alone does not move attached clients.
    herdr.call("pane.focus", {"pane_id": focused})
    path.unlink()
    _sync_directory(path.parent)
    return {"target_tab_id": target_tab, "target_workspace_id": target_workspace}


def _execute(herdr, path, plan):
    try:
        return _run(herdr, path, plan)
    except BaseException:
        # An uncertain or partial transfer must retain its recovery journal.
        try:
            snapshot = _snapshot(herdr)
            locations = _locations(snapshot, plan)
            if all(pane["tab_id"] == plan["source_tab_id"] for pane in locations.values()):
                layout = _check_tab(herdr, snapshot, plan, plan["source_tab_id"], locations)
                if layout["zoomed"] != plan["zoomed"]:
                    focused = locations[plan["focused_terminal_id"]]["pane_id"]
                    herdr.call("pane.zoom", {
                        "pane_id": focused, "mode": "on" if plan["zoomed"] else "off"})
                path.unlink()
                _sync_directory(path.parent)
        except Exception:
            pass  # Keep the plan when its live state cannot be established.
        raise


def _prepare(herdr, source_tab_id, workspace_id, workspace_name):
    if (workspace_id is None) == (workspace_name is None):
        raise ValueError("Choose exactly one destination workspace.")
    if workspace_name is not None and not workspace_name.strip():
        raise ValueError("A new workspace needs a name.")
    snapshot = _snapshot(herdr)
    tab = next((item for item in snapshot["tabs"] if item["tab_id"] == source_tab_id), None)
    if tab is None:
        raise RuntimeError("The selected source tab no longer exists. Nothing was moved.")
    if workspace_id == tab["workspace_id"]:
        raise ValueError("Choose a different workspace.")
    if workspace_id is not None and not any(
            item["workspace_id"] == workspace_id for item in snapshot["workspaces"]):
        raise RuntimeError("The selected destination no longer exists. Nothing was moved.")
    source_workspace = next(item for item in snapshot["workspaces"]
                            if item["workspace_id"] == tab["workspace_id"])
    worktree = source_workspace.get("worktree")
    if (source_workspace["tab_count"] == 1 and worktree
            and not worktree["is_linked_worktree"] and any(
                item.get("worktree") and item["worktree"]["key"] == worktree["key"]
                and item["worktree"]["is_linked_worktree"]
                for item in snapshot["workspaces"])):
        raise RuntimeError("Keep another tab in the source workspace while its worktrees are open.")
    layout = herdr.call("layout.export", {"tab_id": source_tab_id})["layout"]
    panes = {pane["pane_id"]: pane for pane in snapshot["panes"]
             if pane["tab_id"] == source_tab_id}
    if set(_leaves(layout["root"])) != set(panes):
        raise RuntimeError("The source layout changed. Open the move dialog again.")
    return {
        "version": 1, "endpoint": herdr.endpoint, "source_tab_id": source_tab_id,
        "label": tab["label"], "pane_count": len(panes), "root": layout["root"],
        "zoomed": layout["zoomed"],
        "terminals": {key: pane["terminal_id"] for key, pane in panes.items()},
        "focused_terminal_id": panes[layout["focused_pane_id"]]["terminal_id"],
        "initial_workspaces": [item["workspace_id"] for item in snapshot["workspaces"]],
        "destination": ({"workspace_id": workspace_id} if workspace_id is not None
                        else {"workspace_name": workspace_name.strip()}),
    }


def move_tab(herdr, state_dir, source_tab_id, *, workspace_id=None, workspace_name=None):
    with _locked(herdr, state_dir) as path:
        if _load(path, herdr) is not None:
            raise RuntimeError("An interrupted tab move is pending. Resume it before starting another.")
        plan = _prepare(herdr, source_tab_id, workspace_id, workspace_name)
        _save(path, plan)
        return _execute(herdr, path, plan)


def resume_move(herdr, state_dir):
    with _locked(herdr, state_dir) as path:
        plan = _load(path, herdr)
        if plan is None:
            raise RuntimeError("There is no interrupted tab move to resume.")
        return _execute(herdr, path, plan)


def request_move(herdr, state_dir, source_tab_id, *, workspace_id=None,
                 workspace_name=None, dialog_pid):
    with _locked(herdr, state_dir) as path:
        if _load(path, herdr) is not None:
            raise RuntimeError("An interrupted tab move is pending. Resume it before starting another.")
        plan = _prepare(herdr, source_tab_id, workspace_id, workspace_name)
        plan["dialog_pid"] = dialog_pid
        _save(path, plan)
    herdr.call("plugin.action.invoke", {"action_id": "dotfiles.navigation.finish-tab-move"})


def request_resume(herdr, state_dir, *, dialog_pid):
    with _locked(herdr, state_dir) as path:
        plan = _load(path, herdr)
        if plan is None:
            raise RuntimeError("There is no interrupted tab move to resume.")
        plan["dialog_pid"] = dialog_pid
        _save(path, plan)
    herdr.call("plugin.action.invoke", {"action_id": "dotfiles.navigation.finish-tab-move"})


def main():
    from navigation import Herdr

    herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    plan = pending_move(herdr, state_dir)
    if plan is None:
        return
    try:
        # A popup is owned by its source tab. Finish outside that popup so its
        # process can exit before the source tab disappears.
        dialog_pid = plan.get("dialog_pid")
        if dialog_pid is not None:
            deadline = time.monotonic() + 5
            while True:
                try:
                    os.kill(dialog_pid, 0)
                except ProcessLookupError:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Close the move dialog before resuming the transfer.")
                time.sleep(0.02)
        result = resume_move(herdr, state_dir)
        herdr.notify("Move tab", f"Moved {plan['label']} and all {plan['pane_count']} panes.")
        print(f"Moved tab to {result['target_tab_id']}")
    except Exception as error:
        advice = " Reopen either move shortcut to resume." if pending_move(herdr, state_dir) else ""
        herdr.notify("Move tab paused", f"{error}{advice}")
        raise


if __name__ == "__main__":
    main()
