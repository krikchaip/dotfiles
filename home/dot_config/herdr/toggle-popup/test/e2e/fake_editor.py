#!/usr/bin/env python3
"""Stand-in for $EDITOR: save the arguments and the file, then exit.

While the file E2E_EDITOR_OUT.hold exists, the editor stays open until a
signal comes. Then it writes the signal name to E2E_EDITOR_OUT.signal.
"""

import json
import os
import signal
import sys
import time
from pathlib import Path

out = Path(os.environ["E2E_EDITOR_OUT"])
hold = out.with_name(out.name + ".hold")


def stop(signum, _frame):
    out.with_name(out.name + ".signal").write_text(signal.Signals(signum).name)
    sys.exit(0)


if hold.exists():
    for signum in (signal.SIGHUP, signal.SIGTERM):
        signal.signal(signum, stop)
path = sys.argv[-1]
out.write_text(json.dumps({
    "args": sys.argv[1:], "text": Path(path).read_text(encoding="utf-8")}))
deadline = time.monotonic() + 60
while hold.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
