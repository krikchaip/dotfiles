"""Run fixture checks under a shared disk watchdog, then remove test-owned state.

This is an observed bound, not a filesystem quota. Never use it to copy real
user Package graphs or run arbitrary installers. Authored fixtures remain small.
"""

import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

LIMIT = 128 * 1024**2
FREE_FLOOR = 10 * 1024**3
DEADLINE_SECONDS = 600


def tree_bytes(root):
    """Count logical file bytes without following directory symlinks."""
    total = 0
    for base, _directories, files in os.walk(root):
        for name in files:
            try:
                total += (Path(base) / name).lstat().st_size
            except FileNotFoundError:
                pass
    return total


def make_tree_writable(root):
    """Make only the test-owned tree removable without following symlinks."""
    for base, directories, files in os.walk(root):
        os.chmod(base, 0o700)
        for name in directories:
            path = Path(base) / name
            if not path.is_symlink():
                os.chmod(path, 0o700)
        for name in files:
            path = Path(base) / name
            if not path.is_symlink():
                os.chmod(path, 0o600)


def main():
    """Own one short temporary path and all terminal sockets beneath it."""
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 test/bounded-run.py <fixture command> ...")
    # macOS UNIX socket paths are short. Do not nest under its long default TMPDIR.
    root = Path(tempfile.mkdtemp(prefix="sqb-", dir="/tmp"))
    process = None
    peak = 0
    try:
        if shutil.disk_usage(root).free < FREE_FLOOR:
            raise RuntimeError("Tests require at least 10 GiB free; nothing started")
        (root / "agent").mkdir()
        environment = {
            **os.environ,
            "TMPDIR": str(root),
            "PI_CODING_AGENT_DIR": str(root / "agent"),
            "PI_OFFLINE": "1",
            "SIDE_QUESTS_E2E_SOURCE": "1",
            "SIDE_QUESTS_E2E_JOBS": "1",
            "npm_config_cache": str(root / "npm-cache"),
            "npm_config_update_notifier": "false",
        }
        process = subprocess.Popen(sys.argv[1:], env=environment, start_new_session=True)
        deadline = time.monotonic() + DEADLINE_SECONDS
        while process.poll() is None:
            size = tree_bytes(root)
            peak = max(peak, size)
            if size > LIMIT:
                raise RuntimeError("128 MiB fixture disk limit reached")
            if shutil.disk_usage(root).free < FREE_FLOOR:
                raise RuntimeError("10 GiB free-space test floor reached")
            if time.monotonic() >= deadline:
                raise RuntimeError("600-second fixture deadline reached")
            time.sleep(0.1)
        peak = max(peak, tree_bytes(root))
        if peak > LIMIT:
            raise RuntimeError("128 MiB fixture disk limit exceeded")
        return process.wait()
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        try:
            # tmux servers can outlive the test command's process group.
            for socket in root.rglob("*.sock"):
                if socket.is_socket():
                    subprocess.run(
                        ["tmux", "-S", str(socket), "kill-server"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=5,
                        check=False,
                    )
        finally:
            make_tree_writable(root)
            shutil.rmtree(root)
            print(f"Peak fixture bytes: {peak}; temporary state removed", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
