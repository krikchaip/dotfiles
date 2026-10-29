#!/usr/bin/env python3
"""Workspace-first explorer for invocation-pinned, native single-pane moves."""

import curses
import json
import os
from pathlib import Path
import sys

import move_ui as ui
from navigation import Herdr


def source_ids(herdr):
    """Resolve invocation identity, never the server's current focused pane."""
    terminal_id = os.environ.get("NAV_SOURCE_TERMINAL_ID")
    tab_id = os.environ.get("NAV_SOURCE_PANE_TAB_ID")
    if terminal_id or tab_id:
        if not terminal_id or not tab_id:
            raise RuntimeError("The action did not provide a complete source pane identity.")
        return terminal_id, tab_id
    context = json.loads(os.environ.get("HERDR_PLUGIN_CONTEXT_JSON", "{}") or "{}")
    pane_id = context.get("focused_pane_id") or os.environ.get("HERDR_PANE_ID")
    if not pane_id:
        raise RuntimeError("The action did not provide a source pane ID; no dialog was opened.")
    snapshot = herdr.call("session.snapshot")["snapshot"]
    source = next((pane for pane in snapshot["panes"] if pane["pane_id"] == pane_id), None)
    if source is None:
        raise RuntimeError("The pane that opened this action no longer exists.")
    return source["terminal_id"], source["tab_id"]


def open_dialog():
    herdr = None
    try:
        herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
        terminal_id, tab_id = source_ids(herdr)
        # Herdr attaches the popup to its invocation context and rejects a target.
        herdr.call("plugin.pane.open", {
            "plugin_id": "dotfiles.navigation", "entrypoint": "move-pane",
            "placement": "popup",
            "env": {"NAV_SOURCE_TERMINAL_ID": terminal_id,
                    "NAV_SOURCE_PANE_TAB_ID": tab_id},
        })
        return 0
    except Exception as error:
        print(f"Open pane move dialog: {ui.visible(error)}", file=sys.stderr)
        if herdr is not None:
            try:
                herdr.notify("Pane move dialog failed", ui.visible(error))
            except Exception as notification_error:
                print(f"Notification failed: {ui.visible(notification_error)}", file=sys.stderr)
        return 1


def destinations(snapshot, source_tab_id):
    """Freeze displayed tabs and split anchors together when the explorer opens."""
    panes = {pane["pane_id"]: pane for pane in snapshot["panes"]}
    layouts = {layout["tab_id"]: layout for layout in snapshot["layouts"]}
    groups = []
    for workspace in snapshot["workspaces"]:
        workspace_id = workspace["workspace_id"]
        tabs = []
        for tab in snapshot["tabs"]:
            if tab["workspace_id"] != workspace_id or tab["tab_id"] == source_tab_id:
                continue
            anchor = layouts.get(tab["tab_id"], {}).get("focused_pane_id")
            pane = panes.get(anchor)
            if pane is None:
                continue  # A tab without an available split anchor is not a destination.
            anchor_label = ui.visible(pane.get("title") or pane.get("label") or pane["pane_id"])
            count = tab["pane_count"]
            tabs.append({
                "label": ui.visible(tab.get("label") or tab["tab_id"]),
                "detail": f"{count} {'pane' if count == 1 else 'panes'} · {anchor_label}",
                "anchor": anchor_label,
                "destination": {"type": "tab", "tab_id": tab["tab_id"],
                                "target_pane_id": anchor},
            })
        tabs.append({"label": "+ New tab", "detail": "",
                     "destination": {"type": "new_tab", "workspace_id": workspace_id}})
        groups.append({"id": workspace_id,
                       "label": ui.visible(workspace.get("label") or workspace_id),
                       "tabs": tabs})
    return groups


def choose_destination(screen, context, groups, styles):
    """Pick a workspace on the left, then a tab or new workspace name on the right."""
    source_label, source_workspace = context
    query, name, name_cursor = "", "", 0
    workspace_index = next((i for i, group in enumerate(groups)
                            if group["id"] == source_workspace["id"]), 0)
    tab_index, placement, focus = 0, "right", "workspaces"
    while True:
        matches = [group for group in groups
                   if query.casefold() in f"{group['label']} {group['id']}".casefold()]
        workspace_index = min(workspace_index, len(matches))
        creating = workspace_index == len(matches)
        workspace = None if creating else matches[workspace_index]
        tabs = workspace["tabs"] if workspace else []
        tab_index = min(tab_index, max(0, len(tabs) - 1))
        tab = tabs[tab_index] if tabs else None
        is_tab = tab is not None and tab["destination"]["type"] == "tab"
        if creating:
            destination = {"type": "new_workspace", "label": name.strip()}
            route = f"{name.strip()} / first tab"
            valid = bool(name.strip())
        else:
            destination = dict(tab["destination"])
            route = f"{workspace['label']} / {tab['label']}"
            if is_tab:
                destination["split"] = placement
                route += f" · split {'below' if placement == 'down' else 'right of'} {tab['anchor']}"
            valid = True
        if focus == "tabs" and creating:
            focus = "name"
        elif focus == "name" and not creating:
            focus = "tabs"
        ready = valid and focus != "workspaces"

        screen.bkgd(" ", styles["normal"])
        screen.erase()
        small = ui._too_small(screen, 60, 14)
        if small is None:
            return None
        if small:
            continue
        height, width = screen.getmaxyx()
        column = max(22, min(30, width // 3))
        divider = 2 + column + 1
        right_x, right_width = divider + 2, width - divider - 4
        top, rule = 3, height - 3
        first, stop = top + 2, rule - 1
        hits, input_panel = [], None

        ui._header(screen, styles, source_label, "from " + source_workspace["origin"])
        for y in range(top, rule - 1):
            ui._put(screen, y, divider, "│", 1, styles["border"])

        # Left column: filter, workspaces, and the pinned creation row.
        query_panel = ui._input(screen, top, 2, column, query, len(query),
                             "Find workspace", "/", styles)
        if focus == "workspaces":
            input_panel = query_panel
        hits.append(((2, top, column, 1), "query"))
        count = max(1, stop - 2 - first)
        start = ui._window(workspace_index, len(matches), count)
        for index in range(start, min(len(matches), start + count)):
            group = matches[index]
            state = (None if index != workspace_index else
                     "active" if focus == "workspaces" else "parent")
            area = ui._row(screen, first + index - start, 2, column, group["label"], styles,
                        state=state,
                        trailing="current" if group["id"] == source_workspace["id"] else "")
            hits.append((area, ("workspace", index)))
        if not matches:
            ui._put(screen, first, 6, "No matches", column - 6, styles["dim"])
        create_state = (None if not creating else
                        "active" if focus == "workspaces" else "parent")
        area = ui._row(screen, stop - 1, 2, column, "+ New workspace", styles, state=create_state)
        hits.append((area, ("workspace", len(matches))))

        # Right column: tabs in the chosen workspace, or the new workspace name.
        if creating:
            ui._put(screen, top, right_x + 4, "New workspace", right_width - 4, curses.A_BOLD)
            name_panel = ui._input(screen, first, right_x, right_width, name, name_cursor,
                                query or "Name, e.g. build-tools", "›", styles)
            if focus == "name":
                input_panel = name_panel
            hits.append(((right_x, first, right_width, 1), "name"))
            ui._put(screen, first + 2, right_x + 4, "The pane becomes its first tab.",
                    right_width - 4, styles["dim"])
        else:
            ui._put(screen, top, right_x + 4, workspace["label"], right_width - 4,
                    curses.A_BOLD)
            count = max(1, stop - first)
            start = ui._window(tab_index, len(tabs), count)
            if len(tabs) > count:
                position = f"{tab_index + 1}/{len(tabs)}"
                ui._put(screen, top, right_x + right_width - 2 - len(position), position,
                        len(position), styles["dim"])
            label_width = max(ui._cells(item["label"]) for item in tabs)
            detail_x = right_x + 4 + min(label_width, right_width // 3) + 3
            for index in range(start, min(len(tabs), start + count)):
                item = tabs[index]
                active = focus == "tabs" and index == tab_index
                split = ""
                if active and is_tab:
                    split = f"split {'below' if placement == 'down' else 'right'}"
                area = ui._row(screen, first + index - start, right_x, right_width, item["label"],
                            styles, state="active" if active else None,
                            detail=item["detail"], detail_x=detail_x, trailing=split)
                hits.append((area, ("tab", index)))
                if split:
                    split_x = right_x + right_width - 2 - ui._cells(split)
                    hits.insert(0, ((split_x, area[1], ui._cells(split), 1), "split"))

        # Footer: context hints on the left, the commit button on the right.
        if focus == "workspaces":
            hints = [("↑↓", "select"), ("→", "name" if creating else "tabs"),
                     ("Esc", "clear" if query else "cancel")]
        elif focus == "tabs":
            hints = [("↑↓", "select"), ("←", "workspaces")]
            if is_tab:
                hints.append(("Tab", "right/below"))
            hints.append(("Esc", "cancel"))
        else:
            hints = [("Ctrl-U", "clear"), ("Esc", "back")]
        button = ui._footer(screen, styles, hints,
                            "  Create & move ↵  " if creating else "  Move pane ↵  ", ready)
        hits.insert(0, (button, "move"))

        if focus == "name":
            ui._refresh_input(screen, input_panel, name, name_cursor)
        else:
            ui._refresh_input(screen, input_panel, query, len(query))
        key = ui._key(screen, None)
        action = None
        if key == "\x03":
            return None
        if key == "\x1b":
            if focus == "name":
                focus = "workspaces"
            elif focus == "workspaces" and query:
                query, workspace_index = "", 0
            else:
                return None
            continue
        if isinstance(key, tuple):
            x, y = key
            action = next((target for (hx, hy, hw, hh), target in hits
                           if hx <= x < hx + hw and hy <= y < hy + hh), None)
        elif focus == "workspaces":
            total = len(matches) + 1
            if key in (curses.KEY_UP, curses.KEY_DOWN, curses.KEY_PPAGE, curses.KEY_NPAGE):
                step = count if key in (curses.KEY_PPAGE, curses.KEY_NPAGE) else 1
                step *= -1 if key in (curses.KEY_UP, curses.KEY_PPAGE) else 1
                index = max(0, min(total - 1, workspace_index + step))
                if index != workspace_index:
                    workspace_index, tab_index = index, 0
            elif key in ui.ENTER or key in (curses.KEY_RIGHT, "\t"):
                if creating and not name and not any(
                        group["label"].casefold() == query.casefold() for group in groups):
                    name, name_cursor = query, len(query)
                focus = "name" if creating else "tabs"
            else:
                new_query, _ = ui._edit(query, len(query), key)
                if new_query != query:
                    query, workspace_index, tab_index = new_query, 0, 0
        elif focus == "tabs":
            if key in (curses.KEY_UP, curses.KEY_DOWN, curses.KEY_PPAGE, curses.KEY_NPAGE):
                step = count if key in (curses.KEY_PPAGE, curses.KEY_NPAGE) else 1
                step *= -1 if key in (curses.KEY_UP, curses.KEY_PPAGE) else 1
                tab_index = max(0, min(len(tabs) - 1, tab_index + step))
            elif key in (curses.KEY_LEFT, curses.KEY_BTAB):
                focus = "workspaces"
            elif key in ("\t", " ") and is_tab:
                action = "split"
            elif key in ui.ENTER:
                action = "move"
            elif isinstance(key, str) and key.isprintable():
                focus, query, workspace_index, tab_index = "workspaces", query + key, 0, 0
        elif key in ui.ENTER:
            action = "move"
        elif key in (curses.KEY_UP, curses.KEY_BTAB):
            focus = "workspaces"
        else:
            name, name_cursor = ui._edit(name, name_cursor, key)

        if action == "move" and ready:
            return destination, route
        if action == "split":
            placement = "down" if placement == "right" else "right"
        elif action == "query":
            focus = "workspaces"
        elif action == "name":
            focus = "name"
            name_cursor = ui._click_cursor(name, name_panel, x)
        elif isinstance(action, tuple):
            kind, index = action
            if kind == "workspace":
                if index != workspace_index:
                    workspace_index, tab_index = index, 0
                focus = "name" if index == len(matches) else "workspaces"
            else:
                tab_index, focus = index, "tabs"


def destination_label(destination):
    kind = destination["type"]
    if kind == "tab":
        direction = "below" if destination.get("split") == "down" else "right"
        return f"{destination['tab_id']} · split {direction}"
    if kind == "new_tab":
        return f"{destination['workspace_id']} / New tab"
    return destination.get("label") or "New workspace"


def run(screen):
    curses.raw()
    curses.curs_set(0)
    curses.set_escdelay(25)
    screen.keypad(True)
    try:
        from pane_move import pending_move, request_move, request_resume
        styles = ui._styles()
        herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
        state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
        pending = pending_move(herdr, state_dir)
        if pending is not None:
            details = [f"Pane: {ui.visible(pending['label'])} · 1 pane",
                       f"Destination: {ui.visible(destination_label(pending['destination']))}"]
            choice = ui.choose(screen, "A pane move is pending", details,
                               [("Cancel — leave the pending move unchanged", "cancel"),
                                ("Resume the pending move", "resume")])
            if choice != "resume":
                return 0
            ui.frame(screen, "Queuing pane move resume…", details,
                     "The move starts after this dialog closes.")
            screen.refresh()
            request_resume(herdr, state_dir, dialog_pid=os.getpid())
            return 0

        terminal_id, tab_id = source_ids(herdr)
        snapshot = herdr.call("session.snapshot")["snapshot"]
        source = next((pane for pane in snapshot["panes"]
                       if pane["terminal_id"] == terminal_id and pane["tab_id"] == tab_id), None)
        if source is None:
            raise RuntimeError("The pane that opened this action is no longer in its original tab.")
        workspace = next(item for item in snapshot["workspaces"]
                         if item["workspace_id"] == source["workspace_id"])
        label = source.get("title") or source.get("label") or source["pane_id"]
        tab = next(item for item in snapshot["tabs"] if item["tab_id"] == tab_id)
        origin = f"{workspace.get('label') or workspace['workspace_id']} / {tab.get('label') or tab_id}"
        context = (label, {"id": workspace["workspace_id"], "origin": ui.visible(origin)})
        selection = choose_destination(screen, context, destinations(snapshot, tab_id), styles)
        if selection is None:
            return 0
        destination, target = selection
        ui.frame(screen, "Queuing pane move…",
                 [f"Pane: {ui.visible(label)} · 1 pane", f"Destination: {ui.visible(target)}"],
                 "The move starts after this dialog closes.")
        screen.refresh()
        request_move(herdr, state_dir, terminal_id, tab_id,
                     destination=destination, dialog_pid=os.getpid())
        return 0
    except Exception as error:
        ui.show_error(screen, error, subject="pane")
        return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["open"]:
        sys.exit(open_dialog())
    if sys.argv[1:]:
        raise SystemExit("Usage: pane_ui.py [open]")
    sys.exit(curses.wrapper(run))
