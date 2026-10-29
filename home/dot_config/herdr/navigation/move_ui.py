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


def _fit(text, width):
    """Clip to terminal cells and mark the cut with an ellipsis."""
    if width <= 0:
        return ""
    return text if _cells(text) <= width else _clip(text, width - 1) + "…"


def _row(screen, y, x, width, label, styles, *, state=None, detail="", detail_x=None,
         trailing=""):
    """Draw one list row; only the focused list gets the filled selection."""
    active = state == "active"
    if active:
        _put(screen, y, x, " " * width, width, styles["selected"])
        _put(screen, y, x, "│", 1, styles["accent"])
        _put(screen, y, x + width - 1, "▌", 1, styles["edge"])
        _put(screen, y, x + 2, "›", 1, styles["selected_label"])
    elif state == "parent":
        _put(screen, y, x + 2, "›", 1, styles["muted"])
    label_style = (styles["selected_label"] if active else
                   styles["normal"] | curses.A_BOLD if state == "parent" else
                   styles["dim"] if state == "inactive" else styles["normal"])
    secondary = (styles["selected_muted"] if active else
                 styles["dim"] if state == "inactive" else styles["muted"])
    end = x + width - 2
    if trailing:
        trailing_x = end - _cells(trailing)
        _put(screen, y, trailing_x, trailing, _cells(trailing), secondary)
        end = trailing_x - 2
    label_end = min(end, detail_x - 2) if detail and detail_x else end
    _put(screen, y, x + 4, _fit(label, label_end - x - 4), label_end - x - 4, label_style)
    if detail and detail_x:
        _put(screen, y, detail_x, _fit(detail, end - detail_x), end - detail_x, secondary)
    return (x, y, width, 1)


def _input(screen, y, x, width, value, cursor, placeholder, prefix, styles):
    """Draw a one-row filled input and return its cursor geometry."""
    _put(screen, y, x, " " * width, width, styles["field"])
    # Align the prefix and text with list markers and labels below.
    _put(screen, y, x + 2, prefix, 1, styles["field_accent"])
    offset = 0
    while _cells(value[offset:cursor]) > width - 6:
        offset += 1
    _put(screen, y, x + 4, value[offset:] if value else placeholder, width - 5,
         styles["field"] if value else styles["placeholder"])
    return {"input_row": y, "input_x": x + 4, "offset": offset}


def _window(selected, total, count):
    """Return the first visible index that keeps the selection on screen."""
    return max(0, min(selected - count // 2, total - count))


def _header(screen, styles, title, origin):
    """Draw the subject on the left, its origin on the right, and a rule."""
    width = screen.getmaxyx()[1]
    origin_width = min(_cells(origin), width // 2)
    _put(screen, 0, 2, title, width - origin_width - 6, curses.A_BOLD)
    _put(screen, 0, width - origin_width - 2, origin, origin_width, styles["dim"])
    _put(screen, 1, 0, "─" * width, width, styles["border"])


def _footer(screen, styles, hints, button_text, ready):
    """Draw the bottom rule, key hints, and commit button; return its area."""
    height, width = screen.getmaxyx()
    _put(screen, height - 3, 0, "─" * width, width, styles["border"])
    button_x = width - 2 - _cells(button_text)
    hint_x = 2
    for key_text, description in hints:
        key_text, description = f" {key_text} ", f" {description}  "
        size = _cells(key_text + description)
        if hint_x + size > button_x - 1:
            break
        _put(screen, height - 1, hint_x, key_text, _cells(key_text), styles["key"])
        _put(screen, height - 1, hint_x + _cells(key_text), description,
             _cells(description), styles["muted"])
        hint_x += size
    _put(screen, height - 1, button_x, button_text, _cells(button_text),
         styles["button"] if ready else styles["disabled"])
    return (button_x, height - 1, _cells(button_text), 1)


def _too_small(screen, min_width, min_height):
    """Show a resize notice; return None to cancel, True to redraw, False if it fits."""
    height, width = screen.getmaxyx()
    if width >= min_width and height >= min_height:
        return False
    line(screen, 0, "Enlarge the terminal to use this dialog.", curses.A_BOLD)
    line(screen, height - 1, "Esc/Ctrl-C cancel", curses.A_DIM)
    _refresh_input(screen, None, "", 0)
    return None if _key(screen, None) in CANCEL else True


def choose_destination(screen, context, choices, styles):
    """Pick a workspace for the tab from one filtered list, or name a new one."""
    label, origin = context
    query, name, name_cursor = "", "", 0
    selected, naming = 0, False
    while True:
        matches = [choice for choice in choices
                   if query.casefold() in
                   f"{choice['label']} {choice['directory']} {choice['id']}".casefold()]
        selected = min(selected, len(matches))
        creating = naming or selected == len(matches)
        proposed = (name if naming else query).strip()
        ready = not creating or bool(proposed)

        screen.bkgd(" ", styles["normal"])
        screen.erase()
        small = _too_small(screen, 40, 12)
        if small is None:
            return None
        if small:
            continue
        height, width = screen.getmaxyx()
        x, list_width = 2, width - 4
        top, first, stop = 3, 5, height - 4
        hits = []
        _header(screen, styles, label, origin)
        if naming:
            panel = _input(screen, top, x, list_width, name, name_cursor,
                           "Name the new workspace", "›", styles)
        else:
            panel = _input(screen, top, x, list_width, query, len(query),
                           "Find a workspace, or type a new name", "/", styles)
        hits.append(((x, top, list_width, 1), "field"))

        # Naming keeps the list in place, dimmed, so only the field and create row change.
        count = max(1, stop - 2 - first)
        start = _window(selected, len(matches), count)
        label_width = max((_cells(choice["label"]) for choice in matches), default=0)
        detail_x = x + 4 + min(label_width, list_width // 3) + 3
        for index in range(start, min(len(matches), start + count)):
            choice = matches[index]
            tabs = f"{choice['tabs']} {'tab' if choice['tabs'] == 1 else 'tabs'}"
            state = "inactive" if naming else "active" if index == selected else None
            area = _row(screen, first + index - start, x, list_width, choice["label"],
                        styles, state=state, detail=choice["directory"], detail_x=detail_x,
                        trailing=tabs)
            hits.append((area, index))
        if not matches:
            _put(screen, first, x + 4,
                 "No matching workspaces" if query else "No other workspaces",
                 list_width - 6, styles["dim"])
        create_label = "+ New workspace" + (f" “{proposed}”" if proposed else "")
        area = _row(screen, stop - 1, x, list_width, create_label, styles,
                    state="active" if creating else None)
        hits.append((area, len(matches)))

        if naming:
            hints = [("Ctrl-U", "clear"), ("Esc", "back")]
        elif creating and not proposed:
            hints = [("↑↓", "select"), ("↵", "name it"), ("Esc", "cancel")]
        else:
            hints = [("↑↓", "select"), ("Esc", "clear" if query else "cancel")]
        button = _footer(screen, styles, hints,
                         "  Create & move ↵  " if creating else "  Move tab ↵  ", ready)
        hits.insert(0, (button, "move"))
        if naming:
            _refresh_input(screen, panel, name, name_cursor)
        else:
            _refresh_input(screen, panel, query, len(query))

        key = _key(screen, None)
        if key == "\x03":
            return None
        if key == "\x1b":
            if naming:
                naming = False
            elif query:
                query, selected = "", 0
            else:
                return None
            continue
        action = None
        if isinstance(key, tuple):
            mouse_x, mouse_y = key
            action = next((target for (hx, hy, hw, hh), target in hits
                           if hx <= mouse_x < hx + hw and hy <= mouse_y < hy + hh), None)
            if action == "field" and naming:
                name_cursor = _click_cursor(name, panel, mouse_x)
        elif key in ENTER:
            action = "move"
        elif naming:
            name, name_cursor = _edit(name, name_cursor, key)
        elif key in (curses.KEY_UP, curses.KEY_DOWN, curses.KEY_PPAGE, curses.KEY_NPAGE):
            step = count if key in (curses.KEY_PPAGE, curses.KEY_NPAGE) else 1
            step *= -1 if key in (curses.KEY_UP, curses.KEY_PPAGE) else 1
            selected = max(0, min(len(matches), selected + step))
        else:
            new_query, _ = _edit(query, len(query), key)
            if new_query != query:
                query, selected = new_query, 0

        if action == "move":
            if not creating:
                return {"workspace_id": matches[selected]["id"]}, matches[selected]["label"]
            if proposed:
                return {"workspace_name": proposed}, proposed
            naming, name, name_cursor = True, "", 0
        elif isinstance(action, int) and not naming:
            selected = action


def show_error(screen, error, *, subject="tab"):
    offset = 0
    while True:
        width = max(1, screen.getmaxyx()[1] - 1)
        lines = textwrap.wrap(visible(error), width=width) or ["Unknown error"]
        count = max(1, screen.getmaxyx()[0] - 6)
        offset = min(offset, max(0, len(lines) - count))
        frame(screen, f"{subject.capitalize()} move failed", [], "Enter/Esc close · ↑/↓ scroll")
        for row, text in enumerate(lines[offset:offset + count], 2):
            line(screen, row, text)
        height = screen.getmaxyx()[0]
        line(screen, height - 3, f"If pending, rerun the {subject} move shortcut to resume.")
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


def open_dialog():
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
            "entrypoint": "move-tab",
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
        source_workspace = next(item for item in snapshot["workspaces"]
                                if item["workspace_id"] == source["workspace_id"])
        origin = (f"from {visible(source_workspace['label'] or source_workspace['workspace_id'])}"
                  f" · {pane_count} {'pane' if pane_count == 1 else 'panes'}")
        panes = {pane["pane_id"]: pane for pane in snapshot["panes"]}
        layouts = {layout["tab_id"]: layout for layout in snapshot["layouts"]}
        home = os.path.expanduser("~")
        choices = []
        for workspace in snapshot["workspaces"]:
            if workspace["workspace_id"] == source["workspace_id"]:
                continue
            focused = layouts.get(workspace["active_tab_id"], {}).get("focused_pane_id")
            pane = panes.get(focused, {})
            directory = pane.get("foreground_cwd") or pane.get("cwd") or ""
            if directory == home or directory.startswith(home + "/"):
                directory = "~" + directory[len(home):]
            choices.append(dict(id=workspace["workspace_id"],
                                label=visible(workspace["label"] or workspace["workspace_id"]),
                                directory=visible(directory), tabs=workspace["tab_count"]))
        selection = choose_destination(screen, (visible(label), origin), choices, styles)
        if selection is None:
            return 0
        destination, target = selection
        frame(screen, "Queuing tab move…", details + [f"Destination: {visible(target)}"],
              "The move starts after this dialog closes.")
        screen.refresh()
        request_move(herdr, state_dir, source_id, dialog_pid=os.getpid(), **destination)
        return 0
    except Exception as error:
        show_error(screen, error)
        return 1


if __name__ == "__main__":
    if sys.argv[1:] == ["open"]:
        sys.exit(open_dialog())
    if sys.argv[1:]:
        raise SystemExit("Usage: move_ui.py [open]")
    sys.exit(curses.wrapper(run))
