#!/usr/bin/env python3
"""Backing program for E2E tests: ask for a keyboard mode, then log each read.

Usage: keylog.py MODE LOG_FILE
MODE is legacy, kitty (flags 1), kitty-all (flags 11), or mok (modifyOtherKeys 2).
Each read is appended to LOG_FILE as hex, and shown on screen.
"""

import os
import sys
import tty

MODES = {"legacy": "", "kitty": "\x1b[>1u", "kitty-all": "\x1b[>11u", "mok": "\x1b[>4;2m"}


def main():
    mode, path = sys.argv[1], sys.argv[2]
    tty.setraw(0)
    os.write(1, f"{MODES[mode]}keylog {mode} ready\r\n".encode())
    with open(path, "a", buffering=1, encoding="ascii") as log:
        while True:
            data = os.read(0, 4096)
            if not data:
                return
            log.write(data.hex(" ") + "\n")
            os.write(1, f"got {data!r}\r\n".encode())


if __name__ == "__main__":
    main()
