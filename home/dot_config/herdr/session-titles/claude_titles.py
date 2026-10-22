#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["claude-agent-sdk==0.2.172"]
# ///
"""Mirror Claude's native title metadata without configuring its status line."""

import json
import os
from pathlib import Path
import subprocess
import sys
import time

from claude_agent_sdk import get_session_info

from session_titles import Herdr, RAW_KEYS, normalized, reference


def sync_server(endpoint):
    herdr = Herdr(endpoint)
    snapshot = herdr.snapshot()
    for agent in snapshot["agents"]:
        native = agent.get("agent_session") or {}
        if agent.get("agent") != "claude" or native.get("kind") != "id" or not native.get("value"):
            continue
        # Only this SDK field excludes prompt/directory display-name fallbacks.
        # The SDK reads bounded local session-file excerpts; it makes no model call.
        seq = time.time_ns()
        info = get_session_info(native["value"])
        if info is None:
            # A fresh --name session has no file yet; keep its SessionStart name.
            continue
        name = normalized(info.custom_title or "")[:80]
        expected = ({"native_session_name": name,
                     "native_session_ref": reference(native["value"]),
                     "native_session_agent": "claude"} if name else dict.fromkeys(RAW_KEYS))
        if all(agent.get("tokens", {}).get(key) == value for key, value in expected.items()):
            continue
        environment = {**os.environ, "HERDR_ENV": "1", "HERDR_SOCKET_PATH": endpoint,
                       "HERDR_PANE_ID": agent["pane_id"]}
        subprocess.run(
            [sys.executable, str(Path(__file__).with_name("session_titles.py")), "publish",
             json.dumps({"agent": "claude", "name": name or None,
                         "session_ref": native["value"], "seq": seq})],
            env=environment, check=True, timeout=3,
        )


def main():
    while True:
        inventory = json.loads(subprocess.check_output(
            ["herdr", "session", "list", "--json"], text=True, timeout=3,
        ))
        for session in inventory["sessions"]:
            if not session["running"]:
                continue
            try:
                sync_server(session["socket_path"])
            except (FileNotFoundError, ConnectionRefusedError, ConnectionResetError):
                # A server can close between inventory and its socket request.
                continue
        time.sleep(2)


if __name__ == "__main__":
    main()
