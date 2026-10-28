#!/usr/bin/env python3
"""Interactive, invocation-pinned whole-tab relocation popup.

Popup roles use the terminal's ANSI palette and Kitty's live theme tokens.
The fill uses Kitty's remote-control socket directly, with a 100 ms local I/O
deadline and a 64 KiB response limit. No color-query process or watcher is started.
Protocol: https://sw.kovidgoyal.net/kitty/rc_protocol/
Herdr owns the outer frame; spacing and font weights remain cell-based.
Filled controls use explicit palette slots rather than the default background.
"""

import curses
import json
import os
from pathlib import Path
import socket
import sys
import textwrap
import time
import unicodedata

from navigation import Herdr


CANCEL = ("\x1b", "\x03")
BACKSPACE = (curses.KEY_BACKSPACE, "\x7f", "\b")
ENTER = ("\n", "\r", curses.KEY_ENTER)


def visible(value):
    """Keep server labels and exceptions from becoming terminal commands."""
    return "".join(char if char.isprintable() else ascii(char)[1:-1]
                   for char in str(value))


def line(screen, row, text, attribute=0):
    height, width = screen.getmaxyx()
    if 0 <= row < height and width > 1:
        try:
            screen.addnstr(row, 0, visible(text), width - 1, attribute)
        except curses.error:
            pass  # Wide glyphs and terminal resizes can reach the right edge.


def frame(screen, heading, details, footer):
    screen.erase()
    line(screen, 0, heading, curses.A_BOLD)
    for row, detail in enumerate(details, 1):
        line(screen, row, detail)
    line(screen, screen.getmaxyx()[0] - 1, footer, curses.A_DIM)


def choose(screen, heading, details, choices):
    """Choose whether to resume a pending transfer."""
    selected = 0
    while True:
        frame(screen, heading, details,
              "↑/↓ select · Enter confirm · Esc/Ctrl-C cancel")
        start = len(details) + 2
        count = max(1, screen.getmaxyx()[0] - start - 1)
        first = max(0, selected - count + 1)
        for row, (label, _) in enumerate(choices[first:first + count], start):
            index = first + row - start
            line(screen, row, ("> " if index == selected else "  ") + label,
                 curses.A_REVERSE if index == selected else 0)
        screen.refresh()
        key = screen.get_wch()
        if key in CANCEL:
            return None
        if key in ENTER:
            return choices[selected][1]
        if key == curses.KEY_UP:
            selected = max(0, selected - 1)
        elif key == curses.KEY_DOWN:
            selected = min(len(choices) - 1, selected + 1)
        elif key == curses.KEY_PPAGE:
            selected = max(0, selected - count)
        elif key == curses.KEY_NPAGE:
            selected = min(len(choices) - 1, selected + count)


def _cells(text):
    return sum(0 if unicodedata.combining(char) else
               2 if unicodedata.east_asian_width(char) in "WF" else 1
               for char in text)


def _clip(text, width):
    result = []
    for char in text:
        size = _cells(char)
        if size > width:
            break
        result.append(char)
        width -= size
    return "".join(result)


def _put(screen, row, column, text, width, attribute=0):
    height, columns = screen.getmaxyx()
    if 0 <= row < height and 0 <= column < columns:
        width = min(width, columns - column - (row == height - 1))
        if width > 0:
            try:
                screen.addstr(row, column, _clip(visible(text), width), attribute)
            except curses.error:
                pass  # A resize can invalidate the measured rectangle.


def _kitty_surface():
    """Read a live surface token directly, without starting the Kitty CLI."""
    endpoint = os.environ.get("KITTY_LISTEN_ON")
    if not endpoint:
        return None
    window_id = os.environ.get("KITTY_WINDOW_ID")
    if window_id:
        if not window_id.isascii() or not window_id.isdecimal():
            return None
        payload = {"match": f"id:{window_id}"}
    else:
        # The active window may belong to another client.
        payload = {"configured": True}
    request = {"cmd": "get-colors", "version": [0, 14, 2], "payload": payload}
    prefix, suffix = b"\x1bP@kitty-cmd", b"\x1b\\"
    deadline = time.monotonic() + 0.1
    try:
        if endpoint.startswith("unix:"):
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        elif endpoint.startswith("tcp:"):
            host, port = endpoint[4:].rsplit(":", 1)
            connection = socket.create_connection((host.strip("[]"), int(port)), timeout=0.1)
        else:
            return None
        with connection:
            connection.settimeout(0.1)
            if endpoint.startswith("unix:"):
                address = endpoint[5:]
                if address.startswith("@"):
                    address = "\0" + address[1:]
                connection.connect(address)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            connection.settimeout(remaining)
            connection.sendall(prefix + json.dumps(request).encode() + suffix)
            connection.shutdown(socket.SHUT_WR)
            response = bytearray()
            while not response.endswith(suffix):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or len(response) >= 65536:
                    return None
                connection.settimeout(remaining)
                chunk = connection.recv(min(8192, 65536 - len(response)))
                if not chunk:
                    return None
                response.extend(chunk)
        if not response.startswith(prefix):
            return None
        result = json.loads(response[len(prefix):-len(suffix)])
        if not isinstance(result, dict) or result.get("ok") is not True:
            return None
        colors = result.get("data")
        if not isinstance(colors, str):
            return None
    except (OSError, ValueError, OverflowError, RecursionError):
        return None  # Theme lookup must not prevent a tab move.
    for line in colors.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0] == "inactive_border_color":
            value = fields[1]
            if len(value) == 7 and value.startswith("#"):
                try:
                    return tuple(bytes.fromhex(value[1:]))
                except ValueError:
                    pass
            return None
    return None


def _styles():
    """Bind semantic roles without changing the terminal's global palette."""
    styles = dict(normal=0, accent=curses.A_BOLD, muted=curses.A_DIM,
                  dim=curses.A_DIM, border=curses.A_DIM, field=0,
                  field_accent=curses.A_BOLD, placeholder=curses.A_DIM,
                  selected=curses.A_REVERSE, selected_label=curses.A_REVERSE,
                  selected_muted=curses.A_REVERSE, selected_dim=curses.A_REVERSE,
                  success=0, key=curses.A_REVERSE, edge=0,
                  button=curses.A_BOLD | curses.A_REVERSE, disabled=curses.A_DIM)
    if curses.has_colors():
        try:
            curses.start_color()
            curses.use_default_colors()
            bright = 8 if curses.COLORS >= 16 else 0
            tokens = {
                "background": curses.COLOR_BLACK,
                "text": curses.COLOR_WHITE + bright,
                "muted": curses.COLOR_WHITE,
                "surface": curses.COLOR_BLACK + bright,
                "control_surface": curses.COLOR_BLACK,
                "border": curses.COLOR_BLACK + bright if bright else curses.COLOR_WHITE,
                "accent": curses.COLOR_BLUE,
                "success": curses.COLOR_GREEN,
            }
            if curses.can_change_color() and curses.COLORS > 16:
                surface = _kitty_surface()
                if surface is not None:
                    # Herdr keeps this slot inside the popup's terminal.
                    # Round up because its 1000-to-255 conversion truncates.
                    curses.init_color(16, *((channel * 1000 + 254) // 255
                                            for channel in surface))
                    tokens["control_surface"] = 16
            pairs = {
                "normal": ("text", "background"),
                "accent": ("accent", "background"),
                "muted": ("muted", "background"),
                "dim": ("muted", "background"),
                "border": ("border", "background"),
                "field": ("text", "control_surface"),
                "field_accent": ("accent", "control_surface"),
                "placeholder": ("muted", "control_surface"),
                "selected": ("text", "control_surface"),
                "selected_label": ("accent", "control_surface"),
                "selected_muted": ("muted", "control_surface"),
                "selected_dim": ("muted", "control_surface"),
                "success": ("success", "background"),
                "key": ("text", "surface"),
                "edge": ("control_surface", "background"),
                "button": ("background", "accent"),
                "disabled": ("muted", "surface"),
            }
            for index, (name, (foreground, background)) in enumerate(pairs.items(), 1):
                curses.init_pair(index, tokens[foreground], tokens[background])
                styles[name] = curses.color_pair(index)
                if name in ("dim", "placeholder", "selected_dim", "disabled"):
                    styles[name] |= curses.A_DIM
        except curses.error:
            pass  # Keep the available terminal styling; keyboard input still works.
    try:
        curses.mousemask(curses.ALL_MOUSE_EVENTS)
    except curses.error:
        pass  # Keyboard input does not require terminal mouse support.
    return styles


def _edit(value, cursor, key):
    if key in BACKSPACE and cursor:
        return value[:cursor - 1] + value[cursor:], cursor - 1
    if key == curses.KEY_DC:
        return value[:cursor] + value[cursor + 1:], cursor
    if key == curses.KEY_LEFT:
        return value, max(0, cursor - 1)
    if key == curses.KEY_RIGHT:
        return value, min(len(value), cursor + 1)
    if key in (curses.KEY_HOME, "\x01"):
        return value, 0
    if key in (curses.KEY_END, "\x05"):
        return value, len(value)
    if key == "\x15":
        return "", 0
    if isinstance(key, str) and key.isprintable():
        return value[:cursor] + key + value[cursor:], cursor + len(key)
    return value, cursor


def _panel(screen, context, pane_count, styles, value, cursor, *, new, enabled):
    """Render the compact picker using terminal cells, not font-size changes."""
    screen.bkgd(" ", styles["normal"])
    screen.erase()
    height, width = screen.getmaxyx()
    if height < 15 or width < 32:
        line(screen, 0, "Enlarge the terminal to use this dialog.", curses.A_BOLD)
        line(screen, height - 1, "Esc/Ctrl-C cancel", curses.A_DIM)
        screen.refresh()
        return None
    padding = 2
    body_width = width - 2 * padding
    mode = "NEW WORKSPACE" if new else "EXISTING WORKSPACE"
    _put(screen, 0, padding, "TAB TRANSFER", body_width, styles["muted"])
    if width >= 48:
        _put(screen, 0, width - padding - len(mode), mode, len(mode), styles["dim"])
    _put(screen, 1, 0, "─" * width, width, styles["border"])
    roomy = height >= 22
    heading_row, input_row, first = (3, 8, 10) if roomy else (2, 5, 7)
    if new:
        first += 1  # Separate the new-workspace preview from the input border.
    heading = "Create a workspace for this tab" if new else "Where should this tab go?"
    _put(screen, heading_row, padding, heading, body_width, curses.A_BOLD)
    source_label, workspace_label = context
    source_label = _clip(visible(source_label), body_width)
    _put(screen, heading_row + 1, padding, source_label, body_width)
    context_x = padding + _cells(source_label)
    _put(screen, heading_row + 1, context_x, " · ", padding + body_width - context_x,
         styles["dim"])
    _put(screen, heading_row + 1, context_x + 3,
         f"{visible(workspace_label)} / {pane_count} panes",
         padding + body_width - context_x - 3, styles["dim"])
    label = "New workspace name" if new else "Destination workspace"
    _put(screen, input_row - 2 if roomy else input_row - 1,
         padding, label, body_width, styles["muted"])
    field_x = padding + (1 if roomy else 0)
    field_width = body_width - (2 if roomy else 0)
    if roomy:
        _put(screen, input_row - 1, padding, "┌" + "─" * (body_width - 2) + "┐",
             body_width, styles["border"])
        _put(screen, input_row + 1, padding, "└" + "─" * (body_width - 2) + "┘",
             body_width, styles["border"])
        _put(screen, input_row, padding, "│", 1, styles["border"])
        _put(screen, input_row, width - padding - 1, "│", 1, styles["border"])
    input_x = padding + 4
    input_width = field_x + field_width - input_x
    offset = 0
    while _cells(value[offset:cursor]) > input_width - 1:
        offset += 1
    _put(screen, input_row, field_x, " " * field_width, field_width, styles["field"])
    _put(screen, input_row, padding + 2, "›" if new else "/", 1,
         styles["field_accent"])
    content = value[offset:] if value else (
        "e.g. agent-sandbox" if new else "Type to filter workspaces...")
    _put(screen, input_row, input_x, content, input_width,
         styles["field"] if value else styles["placeholder"])
    stop = height - 5
    _put(screen, stop, padding, "─" * body_width, body_width, styles["border"])
    _put(screen, height - 4, padding, "✓", 1, styles["success"])
    safety = f"All {pane_count} panes stay running. Layout and focus follow."
    _put(screen, height - 4, padding + 2,
         safety if body_width - 2 >= len(safety) else "All panes stay running.",
         body_width - 2, styles["muted"])
    _put(screen, height - 3, 0, "─" * width, width, styles["border"])
    button = "  Create & move  ↵  " if new else "  Move tab  ↵  "
    button_width = _cells(button)
    button_x = width - padding - button_width
    footer_row = height - 1
    hint_x = padding
    for text, style in [((" Ctrl-U " if new else " ↑↓ "), "key"),
                        ((" clear  " if new else " select  "), "muted"),
                        (" Esc ", "key"), (" cancel", "muted")]:
        _put(screen, footer_row, hint_x, text, button_x - hint_x - 1, styles[style])
        hint_x += _cells(text)
    button_style = styles["button"] if enabled else styles["disabled"]
    _put(screen, footer_row, button_x, button, button_width, button_style)
    return dict(first=first, stop=stop, padding=padding, width=body_width,
                input_row=input_row, input_x=input_x, offset=offset,
                button=(button_x, footer_row, button_width, 1))


def _refresh_input(screen, panel, value, cursor):
    """Place the native cursor without inserting a character into the input."""
    try:
        curses.curs_set(1 if panel and value else 0)
        if panel and value:
            screen.move(panel["input_row"],
                        panel["input_x"] + _cells(value[panel["offset"]:cursor]))
    except curses.error:
        pass  # Cursor visibility support varies by terminal.
    screen.refresh()


def _key(screen, panel):
    key = screen.get_wch()
    if key != curses.KEY_MOUSE:
        return key
    _, x, y, _, buttons = curses.getmouse()
    if buttons & curses.BUTTON4_PRESSED:
        return curses.KEY_UP
    if buttons & getattr(curses, "BUTTON5_PRESSED", 0):
        return curses.KEY_DOWN
    if buttons & (curses.BUTTON1_PRESSED | curses.BUTTON1_CLICKED):
        if panel:
            left, row, width, height = panel["button"]
            if row <= y < row + height and left <= x < left + width:
                return "\n"
        return x, y
    return None


def _click_cursor(value, panel, x):
    cursor = panel["offset"]
    column = panel["input_x"]
    while cursor < len(value) and column + _cells(value[cursor]) <= x:
        column += _cells(value[cursor])
        cursor += 1
    return cursor


def choose_workspace(screen, context, pane_count, choices, styles):
    query, cursor, selected = "", 0, 0
    while True:
        matches = [choice for choice in choices
                   if query.casefold() in
                   f"{choice['label']} {choice['directory']} {choice['id']}".casefold()]
        selected = min(selected, max(0, len(matches) - 1))
        panel = _panel(screen, context, pane_count, styles, query, cursor,
                       new=False, enabled=bool(matches))
        stride, first, count = 1, 0, 1
        if panel:
            stride = 2 if screen.getmaxyx()[0] >= 21 and panel["width"] >= 48 else 1
            count = max(1, (panel["stop"] - panel["first"]) // stride)
            first = max(0, selected - count + 1)
            for index, choice in enumerate(matches[first:first + count], first):
                row = panel["first"] + (index - first) * stride
                active = index == selected
                attribute = styles["selected"] if active else styles["normal"]
                x, width = panel["padding"], panel["width"]
                for offset in range(stride):
                    _put(screen, row + offset, x + 1, " " * (width - 2),
                         width - 2, attribute)
                    if active:
                        # Match the input's vertical stroke; cap its far edge
                        # at the same half-cell boundary as the input border.
                        _put(screen, row + offset, x, "│", 1, styles["accent"])
                        _put(screen, row + offset, x + width - 1, "▌", 1, styles["edge"])
                _put(screen, row, x + 2, "›" if active else " ", 1,
                     styles["selected_label"] if active else attribute)
                tabs = choice["tabs"]
                counter = f"{tabs} {'tab' if tabs == 1 else 'tabs'}"
                _put(screen, row, x + 4, choice["label"],
                     width - _cells(counter) - 7,
                     styles["selected_label"] if active else styles["normal"])
                _put(screen, row, x + width - len(counter) - 2, counter, len(counter),
                     styles["selected_muted"] if active else styles["muted"])
                if stride == 2:
                    secondary = styles["selected_dim"] if active else styles["dim"]
                    _put(screen, row + 1, x + 4, "active pane: " + choice["directory"],
                         width - 5, secondary)
            if not matches:
                _put(screen, panel["first"], panel["padding"],
                     "No matching workspaces.", panel["width"], styles["muted"])
        _refresh_input(screen, panel, query, cursor)
        key = _key(screen, panel)
        if key in CANCEL:
            return None
        if not panel:
            continue
        if key in ENTER and matches:
            return matches[selected]["id"]
        if isinstance(key, tuple):
            x, y = key
            if y == panel["input_row"]:
                cursor = _click_cursor(query, panel, x)
            elif panel["padding"] <= x < panel["padding"] + panel["width"]:
                index = first + (y - panel["first"]) // stride
                if panel["first"] <= y < panel["stop"] and first <= index < min(len(matches), first + count):
                    selected = index
        elif key in (curses.KEY_UP, curses.KEY_PPAGE):
            selected = max(0, selected - (count if key == curses.KEY_PPAGE else 1))
        elif key in (curses.KEY_DOWN, curses.KEY_NPAGE):
            selected = min(max(0, len(matches) - 1),
                           selected + (count if key == curses.KEY_NPAGE else 1))
        else:
            value, cursor = _edit(query, cursor, key)
            if value != query:
                selected = 0
            query = value


def workspace_name(screen, context, pane_count, styles):
    name, cursor = "", 0
    while True:
        panel = _panel(screen, context, pane_count, styles, name, cursor,
                       new=True, enabled=bool(name.strip()))
        if panel:
            rows = [(0, "WILL CREATE", styles["muted"]),
                    (1, name.strip() or "Your new workspace", styles["accent"]),
                    (2, f"1 tab · {pane_count} panes", styles["muted"]),
                    (4, "The current tab becomes its first tab.", styles["dim"])]
            for offset, text, attribute in rows:
                row = panel["first"] + offset
                if row < panel["stop"]:
                    _put(screen, row, panel["padding"] + 2,
                         text, panel["width"] - 2, attribute)
        _refresh_input(screen, panel, name, cursor)
        key = _key(screen, panel)
        if key in CANCEL:
            return None
        if not panel:
            continue
        if key in ENTER and name.strip():
            return name.strip()
        if isinstance(key, tuple):
            x, y = key
            if y == panel["input_row"]:
                cursor = _click_cursor(name, panel, x)
        else:
            name, cursor = _edit(name, cursor, key)


def show_error(screen, error):
    offset = 0
    while True:
        width = max(1, screen.getmaxyx()[1] - 1)
        lines = textwrap.wrap(visible(error), width=width) or ["Unknown error"]
        count = max(1, screen.getmaxyx()[0] - 6)
        offset = min(offset, max(0, len(lines) - count))
        frame(screen, "Tab move failed", [], "Enter/Esc close · ↑/↓ scroll")
        for row, text in enumerate(lines[offset:offset + count], 2):
            line(screen, row, text)
        height = screen.getmaxyx()[0]
        line(screen, height - 3, "If pending, rerun either move shortcut to resume.")
        line(screen, height - 2, "No automatic rollback or process restart.")
        screen.refresh()
        key = screen.get_wch()
        if key in ENTER or key in CANCEL:
            return
        if key in (curses.KEY_DOWN, curses.KEY_NPAGE):
            offset += count if key == curses.KEY_NPAGE else 1
        elif key in (curses.KEY_UP, curses.KEY_PPAGE):
            offset = max(0, offset - (count if key == curses.KEY_PPAGE else 1))


def source_tab_id():
    return (os.environ.get("NAV_SOURCE_TAB_ID") or os.environ.get("HERDR_TAB_ID")
            or json.loads(os.environ.get("HERDR_PLUGIN_CONTEXT_JSON", "{}") or "{}").get("tab_id"))


def open_dialog(mode):
    herdr = None
    try:
        herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
        source_id = source_tab_id()
        if not source_id:
            raise RuntimeError("The action did not provide a source tab ID; no dialog was opened.")
        # Popups attach to the active pane; Herdr rejects an explicit target.
        # Keep the source tab pinned independently for the eventual transfer.
        params = {
            "plugin_id": "dotfiles.navigation",
            "entrypoint": "move-tab" if mode == "open-existing" else "new-workspace-from-tab",
            "placement": "popup",
            "env": {"NAV_SOURCE_TAB_ID": source_id},
        }
        herdr.call("plugin.pane.open", params)
        return 0
    except Exception as error:
        print(f"Open tab move dialog: {visible(error)}", file=sys.stderr)
        if herdr is not None:
            try:
                herdr.notify("Tab move dialog failed", visible(error))
            except Exception as notification_error:
                print(f"Notification failed: {visible(notification_error)}", file=sys.stderr)
        return 1


def run(screen):
    curses.raw()  # Ctrl-C cancels input rather than interrupting dispatch.
    curses.curs_set(0)
    curses.set_escdelay(25)
    screen.keypad(True)
    try:
        from tab_move import pending_move, request_move, request_resume
        styles = _styles()

        if len(sys.argv) != 2 or sys.argv[1] not in ("existing", "new"):
            raise ValueError("Usage: move_ui.py existing|new")
        herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
        state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
        pending = pending_move(herdr, state_dir)
        if pending is not None:
            destination = pending["destination"]
            target = destination.get("workspace_name") or destination.get("workspace_id")
            details = [f"Tab: {visible(pending['label'])} · {pending['pane_count']} panes",
                       f"Destination: {visible(target)}"]
            choice = choose(screen, "A tab move is pending", details,
                            [("Cancel — leave the pending move unchanged", "cancel"),
                             ("Resume the pending move", "resume")])
            if choice != "resume":
                return 0
            frame(screen, "Queuing tab move resume…", details, "The move starts after this dialog closes.")
            screen.refresh()
            request_resume(herdr, state_dir, dialog_pid=os.getpid())
            return 0

        source_id = source_tab_id()
        if not source_id:
            raise RuntimeError("The action did not provide a source tab ID; no tab was moved.")
        snapshot = herdr.call("session.snapshot")["snapshot"]
        source = next((tab for tab in snapshot["tabs"] if tab["tab_id"] == source_id), None)
        if source is None:
            raise RuntimeError("The tab that opened this action no longer exists.")
        label = source["label"] or source_id
        pane_count = source["pane_count"]
        details = [f"Tab: {visible(label)} · {pane_count} panes"]
        workspace = next(item for item in snapshot["workspaces"]
                         if item["workspace_id"] == source["workspace_id"])
        context = (label, workspace["label"] or workspace["workspace_id"])
        if sys.argv[1] == "existing":
            workspaces = [workspace for workspace in snapshot["workspaces"]
                          if workspace["workspace_id"] != source["workspace_id"]]
            if not workspaces:
                raise RuntimeError("No other workspace is open. Use the new-workspace shortcut instead.")
            panes = {pane["pane_id"]: pane for pane in snapshot["panes"]}
            layouts = {layout["tab_id"]: layout for layout in snapshot["layouts"]}
            home = os.path.expanduser("~")
            choices = []
            for workspace in workspaces:
                focused = layouts.get(workspace["active_tab_id"], {}).get("focused_pane_id")
                pane = panes.get(focused, {})
                directory = pane.get("foreground_cwd") or pane.get("cwd") or "unavailable"
                if directory == home or directory.startswith(home + "/"):
                    directory = "~" + directory[len(home):]
                choices.append(dict(id=workspace["workspace_id"],
                                    label=visible(workspace["label"] or workspace["workspace_id"]),
                                    directory=visible(directory), tabs=workspace["tab_count"]))
            target_id = choose_workspace(screen, context, pane_count, choices, styles)
            if target_id is None:
                return 0
            destination = {"workspace_id": target_id}
            target = next(choice["label"] for choice in choices if choice["id"] == target_id)
        else:
            target = workspace_name(screen, context, pane_count, styles)
            if target is None:
                return 0
            destination = {"workspace_name": target}
        frame(screen, "Queuing tab move…", details + [f"Destination: {visible(target)}"],
              "The move starts after this dialog closes.")
        screen.refresh()
        request_move(herdr, state_dir, source_id, dialog_pid=os.getpid(), **destination)
        return 0
    except Exception as error:
        show_error(screen, error)
        return 1


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] in ("open-existing", "open-new"):
        sys.exit(open_dialog(sys.argv[1]))
    sys.exit(curses.wrapper(run))
