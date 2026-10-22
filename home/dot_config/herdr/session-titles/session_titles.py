#!/usr/bin/env python3
"""Publish native session names and resolve Herdr's session-first agent labels."""

import collections
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time

SOURCE = "dotfiles:session-titles"
KINDS = {"claude": "Claude", "omp": "omp"}
AGENT_ICONS = {"claude": "✳", "omp": "π"}
RAW_KEYS = ("native_session_name", "native_session_ref", "native_session_agent")


def normalized(value):
    return " ".join(
        "".join(" " if ord(char) < 32 or 127 <= ord(char) <= 159 else char for char in value).split()
    )


def reference(value):
    return hashlib.sha256(value.encode()).hexdigest() if value else None


class Herdr:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def call(self, method, params=None):
        request = {"id": f"{SOURCE}:{time.time_ns()}", "method": method,
                   "params": params if params is not None else {}}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(self.endpoint)
            client.sendall((json.dumps(request) + "\n").encode())
            with client.makefile("r", encoding="utf-8") as stream:
                response = json.loads(stream.readline())
        if "error" in response:
            raise RuntimeError(f"{method}: {response['error']}")
        return response["result"]

    def snapshot(self):
        return self.call("session.snapshot")["snapshot"]

    def patch(self, pane, tokens, source, seq):
        self.call("pane.report_metadata", {
            "pane_id": pane["pane_id"], "source": source,
            "agent": pane["agent"], "tokens": tokens, "seq": seq,
        })


def session_name(agent):
    tokens = agent.get("tokens", {})
    native = agent.get("agent_session") or {}
    if (tokens.get("native_session_agent") == agent.get("agent")
            and native.get("value")
            and tokens.get("native_session_ref") == reference(native["value"])):
        return normalized(tokens.get("native_session_name", ""))
    # Bootstrap already-running OMP sessions without restarting the agent.
    # OMP's v1 title slot is exactly the first 256 bytes; never read conversation entries.
    if agent.get("agent") == "omp" and native.get("kind") == "path":
        path = Path(native["value"])
        if path.is_absolute():
            try:
                with path.open("rb") as handle:
                    slot = json.loads(handle.read(256))
                if slot.get("type") == "title" and slot.get("v") == 1 and isinstance(slot.get("title"), str):
                    return normalized(slot["title"])
            except (OSError, ValueError):
                pass  # Missing, legacy, or incomplete title metadata means unnamed.
    return ""


def labels(agents):
    names = {agent["pane_id"]: session_name(agent) for agent in agents}
    counts = collections.Counter(
        (agent["agent"], agent["workspace_id"], agent["tab_id"], names[agent["pane_id"]])
        for agent in agents if names[agent["pane_id"]]
    )
    resolved = {}
    for agent in agents:
        pane = agent["pane_id"].rsplit(":", 1)[-1]
        name = names[agent["pane_id"]]
        if name:
            duplicate = counts[(agent["agent"], agent["workspace_id"], agent["tab_id"], name)] > 1
            suffix = f" · {pane}" if duplicate else ""
            label = name[:80 - len(suffix)] + suffix
        else:
            kind = KINDS.get(agent["agent"], agent["agent"])
            label = f"Unnamed {kind} · {pane}"[:80]
        resolved[agent["pane_id"]] = label
    return resolved


def refresh(herdr):
    snapshot = herdr.snapshot()
    agents = [agent for agent in snapshot["agents"] if agent.get("agent")]
    resolved = labels(agents)
    for agent in agents:
        label = resolved[agent["pane_id"]]
        named = bool(session_name(agent))
        patch = {"session_label": label if named else None,
                 "session_fallback": None if named else label,
                 "agent_icon": AGENT_ICONS.get(agent["agent"], agent.get("display_agent") or agent["agent"])}
        if any(agent.get("tokens", {}).get(key) != value for key, value in patch.items()):
            herdr.patch(agent, patch, f"{SOURCE}:label", time.time_ns())


def publish(herdr, payload):
    kind = payload["agent"]
    if kind not in KINDS:
        raise ValueError(f"unsupported native name publisher: {kind}")
    pane = herdr.call("pane.get", {"pane_id": os.environ["HERDR_PANE_ID"]})["pane"]
    # A delayed hook from a previous occupant must not change a different agent.
    if pane.get("agent") != kind:
        refresh(herdr)
        return
    ref = reference(payload.get("session_ref"))
    if not ref:
        raise ValueError("native session reference is required")
    name = normalized(payload.get("name") or "")[:80]
    tokens = pane.get("tokens", {})
    if not name:
        # A new session may clear an older name; a delayed old SessionEnd may not.
        current_ref = reference((pane.get("agent_session") or {}).get("value"))
        if tokens.get("native_session_ref") not in (None, ref) and current_ref != ref:
            refresh(herdr)
            return
        patch = dict.fromkeys(RAW_KEYS)
    else:
        patch = {"native_session_name": name, "native_session_ref": ref,
                 "native_session_agent": kind}
    herdr.patch(pane, patch, f"{SOURCE}:{kind}", payload.get("seq", time.time_ns()))
    refresh(herdr)


def main():
    if os.environ.get("HERDR_ENV") != "1" or not os.environ.get("HERDR_SOCKET_PATH"):
        return
    mode = sys.argv[1]
    seq = time.time_ns()
    endpoint = os.environ["HERDR_SOCKET_PATH"]
    # Hooks, extensions, and plugin events can run concurrently. Serialize their
    # snapshot/patch cycles per server; never hold a lock across agent work.
    directory = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "herdr/session-titles"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"{reference(endpoint)}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        herdr = Herdr(endpoint)
        if mode == "publish":
            if not os.environ.get("HERDR_PANE_ID"):
                return
            publish(herdr, json.loads(sys.argv[2]))
        elif mode == "claude-start":
            data = json.load(sys.stdin)
            if (data.get("hook_event_name") != "SessionStart" or data.get("agent_id")
                    or "CURSOR_VERSION" in os.environ):
                return
            # SessionStart hooks run in parallel; bind to the official identity first.
            deadline = time.monotonic() + 1.5
            while True:
                pane = herdr.call("pane.get", {"pane_id": os.environ["HERDR_PANE_ID"]})["pane"]
                if (pane.get("agent") == "claude"
                        and (pane.get("agent_session") or {}).get("value") == data.get("session_id")):
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Claude's startup session identity was not reported")
                time.sleep(0.025)
            publish(herdr, {"agent": "claude", "name": data.get("session_title"),
                            "session_ref": data.get("session_id"), "seq": seq})
        elif mode == "refresh":
            refresh(herdr)
        else:
            raise ValueError(f"unknown mode: {mode}")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, OSError, RuntimeError) as error:
        print(f"Herdr session titles: {error}", file=sys.stderr)
        sys.exit(1)
