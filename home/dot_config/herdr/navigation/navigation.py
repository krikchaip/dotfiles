#!/usr/bin/env python3
"""Return to the last live tab or workspace without a background watcher.

Read native focus logs backward in 8 KiB chunks, at most 256 KiB per action.
History is shared by clients of one session. Missing or rotated history leaves
focus unchanged with a notification; the native log format is not a public API.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sys

CHUNK_BYTES = 8 * 1024
MAX_SCAN_BYTES = 256 * 1024
FOCUS = re.compile(
    rb'\bevent="(tab|workspace)\.focus"\s.*\bworkspace_id="([^"\r\n]+)"'
    rb'(?:\s+tab_id="([^"\r\n]+)")?(?:\s|$)'
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


def previous_focus(stream, kind, current_id, live_ids, workspace_id=None):
    event_kind = kind.encode()
    workspace = workspace_id.encode() if workspace_id is not None else None
    current = current_id.encode()
    live = {item.encode() for item in live_ids}
    for line in reverse_lines(stream):
        match = FOCUS.search(line)
        if match is None or match[1] != event_kind:
            continue
        if workspace is not None and match[2] != workspace:
            continue
        target = match[3] if kind == "tab" else match[2]
        if target != current and target in live:
            return target.decode()
    return None


class Herdr:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def call(self, method, params=None):
        request = {"id": "dotfiles:navigation", "method": method, "params": params or {}}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(self.endpoint)
            client.sendall((json.dumps(request) + "\n").encode())
            with client.makefile("r", encoding="utf-8") as stream:
                response = json.loads(stream.readline())
        if "error" in response:
            raise RuntimeError(f"{method}: {response['error']}")
        return response["result"]

    def notify(self, title, body):
        self.call("notification.show", {"title": title, "body": body})


def main():
    action = sys.argv[1]
    if action not in ("last-tab", "last-workspace"):
        raise ValueError(f"unknown navigation action: {action}")
    kind = "tab" if action == "last-tab" else "workspace"
    title = f"Last {kind}"
    endpoint = os.environ["HERDR_SOCKET_PATH"]
    herdr = Herdr(endpoint)
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    key = hashlib.sha256(endpoint.encode()).hexdigest()[:16]
    # Serialize rapid keypresses, including the authoritative read and focus.
    with (state_dir / f"{key}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        snapshot = herdr.call("session.snapshot")["snapshot"]
        workspace_id = None
        if kind == "tab":
            workspace_id = os.environ.get("HERDR_WORKSPACE_ID") or snapshot["focused_workspace_id"]
            workspace = next((item for item in snapshot["workspaces"]
                              if item["workspace_id"] == workspace_id), None)
            if workspace is None:
                herdr.notify(title, "No active workspace.")
                return
            current = workspace["active_tab_id"]
            live = {tab["tab_id"] for tab in snapshot["tabs"]
                    if tab["workspace_id"] == workspace_id}
        else:
            current = snapshot["focused_workspace_id"]
            live = {workspace["workspace_id"] for workspace in snapshot["workspaces"]}
        if current is None:
            herdr.notify(title, "No active workspace.")
            return
        if len(live) < 2:
            herdr.notify(title, f"Only one open {kind}.")
            return
        # Default and named sessions keep the server log beside their API socket.
        log_path = Path(endpoint).with_name("herdr-server.log")
        try:
            with log_path.open("rb") as stream:
                target = previous_focus(stream, kind, current, live, workspace_id)
        except FileNotFoundError:
            herdr.notify(title, "Server focus log not found beside the Herdr socket.")
            return
        if target is None:
            herdr.notify(title, f"No previous open {kind} in the newest 256 KiB of focus history.")
            return
        herdr.call(f"{kind}.focus", {f"{kind}_id": target})
        print(f"Focused {target}")


if __name__ == "__main__":
    main()
