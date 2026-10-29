"""Draw Herdr's native close confirmation inside a plugin popup.

Mirrors render_confirm_close_overlay in Herdr's src/client/shell/overlays.rs,
with the active theme tokens from herdr_theme. Curses has no truecolor, so
cells are written as raw SGR. Herdr owns the outer frame. Enter or y confirms;
Esc, n, q, or Ctrl-C cancels.
"""

import os
import re
import select
import signal
import sys
import termios
import tty

from herdr_theme import sgr, tokens
from move_ui import _cells, _fit, visible

MOUSE = re.compile(rb"\x1b\[<(\d+);(\d+);(\d+)([Mm])")


def _draw(title, detail, buttons, theme):
    """Return the screen text and the button columns on its last row."""
    width, height = os.get_terminal_size()
    base = sgr(theme["text"], theme["panel_bg"])
    # Herdr's prompt: title, detail, a gap, then centered buttons.
    lines = [(1, [(_fit(title, width - 2), sgr(theme["red"], theme["panel_bg"], bold=True))]),
             (1, [(_fit(detail, width - 2), base)])]
    lines += [(0, [])] * max(0, height - 3)
    size = sum(_cells(text) for text, _, _ in buttons) + 2 * (len(buttons) - 1)
    x = indent = max(1, (width - size) // 2)
    row, areas = [], []
    for text, value, style in buttons:
        if row:
            row.append(("  ", base))
        row.append((text, style))
        areas.append((x, x + _cells(text), value))
        x += _cells(text) + 2
    lines.append((indent, row))
    output = [base, "\x1b[2J"]
    for number, (indent, cells) in enumerate(lines[:height], 1):
        used = indent + sum(_cells(chunk) for chunk, _ in cells)
        output.append(f"\x1b[{number};1H{base}{' ' * indent}")
        output.extend(style + chunk for chunk, style in cells)
        output.append(f"{base}{' ' * max(0, width - used)}")
    return "".join(output), (height, areas)


def confirm(title, detail, verb):
    """Return True when the user confirms."""
    title, detail = visible(title), visible(detail)
    theme = tokens()
    # Herdr's contrast(): a transparent panel uses surface_dim for button text.
    contrast = theme["panel_bg"] if theme["panel_bg"] is not None else theme["surface_dim"]
    buttons = [(f"  ↵ {verb}  ", True, sgr(contrast, theme["red"], bold=True)),
               (" esc cancel ", False, sgr(theme["text"], theme["surface0"], bold=True))]
    descriptor = sys.stdin.fileno()
    saved = termios.tcgetattr(descriptor)
    resized = []
    signal.signal(signal.SIGWINCH, lambda *_: resized.append(True))
    write = sys.stdout.write
    try:
        tty.setraw(descriptor)
        # Alternate screen, hidden cursor, and SGR mouse clicks.
        write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h")
        while True:
            screen, (height, areas) = _draw(title, detail, buttons, theme)
            write(screen)
            sys.stdout.flush()
            resized.clear()
            while not resized:
                try:
                    ready, _, _ = select.select([descriptor], [], [], 0.5)
                except InterruptedError:
                    continue
                if not ready:
                    continue
                data = os.read(descriptor, 64)
                if data == b"\x1b":
                    # A lone Esc; a key sequence arrives in the same read.
                    return False
                for match in MOUSE.finditer(data):
                    button, x, y, kind = int(match[1]), int(match[2]), int(match[3]), match[4]
                    if button == 0 and kind == b"m" and y == height:
                        for left, right, value in areas:
                            if left <= x - 1 < right:
                                return value
                if data.startswith(b"\x1b"):
                    continue
                if data[:1] in (b"y", b"Y", b"\r", b"\n"):
                    return True
                if data[:1] in (b"n", b"N", b"q", b"\x03"):
                    return False
    finally:
        write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[0m\x1b[?1049l")
        sys.stdout.flush()
        termios.tcsetattr(descriptor, termios.TCSADRAIN, saved)
