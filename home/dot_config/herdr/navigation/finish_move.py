#!/usr/bin/env python3
"""Finish whichever move a popup queued, after that popup closes.

Tab and pane journals exclude each other under one session lock, and each
worker refuses to start while the other's journal exists. Pick the worker
from the journal on disk; with no journal, the pane worker returns unchanged.
"""

import os
from pathlib import Path

from navigation import Herdr
import pane_move
import tab_move


def main():
    herdr = Herdr(os.environ["HERDR_SOCKET_PATH"])
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    with tab_move._locked(herdr, state_dir, allow_pane_move=True) as tab_journal:
        tab_pending = tab_journal.exists()
    (tab_move if tab_pending else pane_move).main()


if __name__ == "__main__":
    main()
