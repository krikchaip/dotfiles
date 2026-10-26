#!/usr/bin/env python3
"""Toggle the last live tab in this workspace without a background watcher."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket

CHUNK_BYTES = 8 * 1024
MAX_SCAN_BYTES = 256 * 1024
FOCUS = re.compile(
    rb'\bevent="tab\.focus"\s.*\bworkspace_id="([^"\r\n]+)"\s+tab_id="([^"\r\n]+)"(?:\s|$)'
)


def reverse_lines(stream):
    """Read complete log records, newest first, within a fixed I/O budget."""
    position = stream.seek(0, os.SEEK_END)
    lower = max(0, position - MAX_SCAN_BYTES)
    pending = b""
    skip_tail = True
    while position > lower:
        start = max(lower, position - CHUNK_BYTES)
        stream.seek(start)
        parts = (stream.read(position - start) + pending).split(b"\n")
        position = start
        pending = parts[0]
        for line in reversed(parts[1:]):
            # The newest fragment is empty or an unfinished log write.
            if skip_tail:
                skip_tail = False
            else:
                yield line
    if position == 0 and not skip_tail:
        yield pending


def previous_tab(stream, workspace_id, current_tab_id, live_tab_ids):
    workspace = workspace_id.encode()
    current = current_tab_id.encode()
    live = {tab.encode() for tab in live_tab_ids}
    for line in reverse_lines(stream):
        match = FOCUS.search(line)
        if match and match[1] == workspace and match[2] != current and match[2] in live:
            return match[2].decode()
    return None


class Herdr:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def call(self, method, params=None):
        request = {"id": "dotfiles:last-tab", "method": method, "params": params or {}}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(self.endpoint)
            client.sendall((json.dumps(request) + "\n").encode())
            with client.makefile("r", encoding="utf-8") as stream:
                response = json.loads(stream.readline())
        if "error" in response:
            raise RuntimeError(f"{method}: {response['error']}")
        return response["result"]

    def notify(self, body):
        self.call("notification.show", {"title": "Last tab", "body": body})


def main():
    endpoint = os.environ["HERDR_SOCKET_PATH"]
    herdr = Herdr(endpoint)
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    key = hashlib.sha256(endpoint.encode()).hexdigest()[:16]
    # Serialize rapid keypresses, including the authoritative read and focus.
    with (state_dir / f"{key}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        snapshot = herdr.call("session.snapshot")["snapshot"]
        workspace_id = os.environ.get("HERDR_WORKSPACE_ID") or snapshot["focused_workspace_id"]
        workspace = next((item for item in snapshot["workspaces"]
                          if item["workspace_id"] == workspace_id), None)
        if workspace is None:
            herdr.notify("No active workspace.")
            return
        live = {tab["tab_id"] for tab in snapshot["tabs"]
                if tab["workspace_id"] == workspace_id}
        if len(live) < 2:
            herdr.notify("This workspace has only one tab.")
            return
        # Default and named sessions keep the server log beside their API socket.
        log_path = Path(endpoint).with_name("herdr-server.log")
        try:
            with log_path.open("rb") as stream:
                target = previous_tab(stream, workspace_id, workspace["active_tab_id"], live)
        except FileNotFoundError:
            herdr.notify("Server focus log not found beside the Herdr socket.")
            return
        if target is None:
            herdr.notify("No previous open tab in the newest 256 KiB of focus history.")
            return
        herdr.call("tab.focus", {"tab_id": target})
        print(f"Focused {target}")


if __name__ == "__main__":
    main()
