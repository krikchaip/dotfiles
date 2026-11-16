#!/usr/bin/env python3
"""Stand-in for $EDITOR: save the arguments, the file and the process id, then exit.

While the file E2E_EDITOR_OUT.hold exists, the editor stays open until a
signal comes. Then it writes the signal name to E2E_EDITOR_OUT.signal.
Meanwhile it shows "fake-editor ready <rows>x<cols> keys <n>", with a bar
cursor as an editor in insert mode has, and appends each input byte that it
reads to E2E_EDITOR_OUT.keys. A resize (SIGWINCH) shows the line again, as
an editor draws its screen again. `q` ends it.
"""

import contextlib
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import time
import tty
from pathlib import Path

out = Path(os.environ["E2E_EDITOR_OUT"])
hold = out.with_name(out.name + ".hold")
keys = out.with_name(out.name + ".keys")
resized = False
count = 0


def stop(signum, _frame):
    out.with_name(out.name + ".signal").write_text(signal.Signals(signum).name)
    sys.exit(0)


def on_resize(_signum, _frame):
    global resized
    resized = True


def draw(first=False):
    rows, cols = struct.unpack("HHHH", fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))[:2]
    sys.stdout.write(f"\x1b[2J\x1b[Hfake-editor ready {rows}x{cols} keys {count}\r\n")
    if first:
        # The bar cursor (DECSCUSR 6) of an editor in insert mode. As nvim, the
        # editor sends it when its mode changes, not when it draws again.
        sys.stdout.write("\x1b[6 q")
    sys.stdout.flush()


if hold.exists():
    for signum in (signal.SIGHUP, signal.SIGTERM):
        signal.signal(signum, stop)
path = sys.argv[-1]
temporary = out.with_name(out.name + ".tmp")
temporary.write_text(json.dumps({
    "args": sys.argv[1:], "text": Path(path).read_text(encoding="utf-8"), "pid": os.getpid(),
    "env": {name: os.environ.get(name) for name in ("EDITOR", "HERDR_SOCKET_PATH")}}))
os.replace(temporary, out)
if hold.exists():
    signal.signal(signal.SIGWINCH, on_resize)
    with contextlib.suppress(termios.error):
        tty.setraw(0)
    draw(first=True)
deadline = time.monotonic() + 120
while hold.exists() and time.monotonic() < deadline:
    try:
        ready, _, _ = select.select([0], [], [], 0.05)
    except InterruptedError:
        ready = []
    if resized:
        resized = False
        draw()
    if ready:
        try:
            data = os.read(0, 1024)
        except OSError:
            data = b""
        if not data:
            # The terminal is gone (EIO on macOS, end of file on Linux): its SIGHUP comes next.
            time.sleep(0.5)
            break
        with keys.open("ab") as stream:
            stream.write(data)
        if b"q" in data:
            break
        count += len(data)
        draw()
