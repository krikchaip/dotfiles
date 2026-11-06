#!/usr/bin/env python3
"""Measure how fast a toggle key shows a popup. This is not a test of the suite.

Usage: bench_toggle.py [RUNS [POLL_MS]]

It starts an isolated stage (its own tmux server and Herdr sessions, as in
the E2E tests), binds alt+1 to a popup that runs toggle.sh, as the repo
config does, and presses the key. It measures the time from the key to the
popup frame, and to the program's text in it. The first show also starts
the popup server and the program (cold). Each later show finds the popup
running (warm).

It runs twice: with the stage's PATH, and with /usr/bin first on the PATH
of the Herdr servers, as on a Mac where Herdr starts from a login shell.
toggle.sh runs /opt/homebrew/bin/python3 when it exists, so on such a Mac
the two runs are the same. Elsewhere the second run can find an old
python3, and the version check then runs.

Python keeps the bytecode of the plugin, as it does in ~/.config/herdr, but
in the stage folder. The bench polls the screen each POLL_MS (default 2).
Each poll starts a tmux process, so a short interval loads the machine.
"""

import os
import statistics
import sys
import time

import harness

READY = "BENCH-READY"
POLL_SECONDS = 0.002


def until(probe, limit=harness.TIMEOUT):
    """Poll probe() until it is true. Return the time when it became true."""
    deadline = time.monotonic() + limit
    while time.monotonic() < deadline:
        if probe():
            return time.monotonic()
        time.sleep(POLL_SECONDS)
    raise TimeoutError("the popup did not show")


def show(stage):
    """Press the key. Return (ms to the frame, ms to the program text)."""
    start = time.monotonic()
    stage.keys("M-1")
    frame = until(stage.popup_visible)
    text = until(lambda: any(READY in row for row in stage.popup_lines()))
    return 1000 * (frame - start), 1000 * (text - start)


def hide(stage):
    stage.keys("M-1")
    until(lambda: not stage.popup_visible())
    # Let the proxy and the viewer end, so that the next show is not slowed.
    time.sleep(0.3)


def report(name, values):
    print(f"{name:>14}: median {statistics.median(values):6.0f} ms  "
          f"max {max(values):6.0f} ms  ({' '.join(f'{v:.0f}' for v in values)})")


def bench(runs, usr_bin_first):
    """Return the cold (frame, text) times and the warm ones."""
    stage = harness.Stage("bench", session="tp-speed")
    del stage.env["PYTHONDONTWRITEBYTECODE"]
    stage.env["PYTHONPYCACHEPREFIX"] = str(stage.root / "pycache")
    if usr_bin_first:
        stage.env["PATH"] = "/usr/bin:" + stage.env.get("PATH", os.defpath)
    try:
        stage.start()
        stage.slot("alt+1", "--toggle-key", "alt+1", "--",
                   "/bin/sh", "-c", f"echo {READY}; exec cat")
        cold = show(stage)
        hide(stage)
        warm = []
        for _ in range(runs):
            warm.append(show(stage))
            hide(stage)
    finally:
        stage.close()
    return cold, warm


def main(argv):
    global POLL_SECONDS
    runs = int(argv[1]) if len(argv) > 1 else 20
    if len(argv) > 2:
        POLL_SECONDS = float(argv[2]) / 1000
    for name, usr_bin_first in (("stage PATH", False), ("/usr/bin first", True)):
        cold, warm = bench(runs, usr_bin_first)
        print(f"{name}: cold show: frame {cold[0]:.0f} ms, text {cold[1]:.0f} ms")
        report("warm frame", [frame for frame, _ in warm])
        report("warm text", [text for _, text in warm])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
