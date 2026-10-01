#!/usr/bin/env python3
"""Check native delegation in an owned Kitty window with GNU Screen.

Never drives an existing window. Copies current Yazi config and tests both a
clean environment and inherited preview variables whose owner has exited.
"""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
from test_runtime import DIRECTORY, png


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=12).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kitty-to", required=True)
    opts = parser.parse_args()
    identity = "ykp-noop-" + uuid.uuid4().hex
    yazi = shutil.which("yazi")
    screen = shutil.which("screen")
    if not yazi or not screen:
        raise RuntimeError("yazi and GNU Screen are required")

    def kitty(*args):
        return command("kitty", "@", "--to", opts.kitty_to, *args)

    results = []
    with tempfile.TemporaryDirectory(prefix=f"ykp-{os.getuid()}-", dir="/tmp") as directory:
        root = pathlib.Path(directory)
        config = root / "yazi"
        shutil.copytree(pathlib.Path.home() / ".config/yazi", config,
                        ignore=shutil.ignore_patterns("__pycache__", "test"))
        plugin = config / "plugins/kitty-popup.yazi"
        plugin.mkdir(parents=True, exist_ok=True)
        for name in ("main.lua", "main.py", "preview.py"):
            shutil.copyfile(DIRECTORY / name, plugin / name)
        for name in ("yazi.toml", "init.lua", "keymap.toml", "theme.toml"):
            shutil.copyfile(DIRECTORY.parent.parent / name, config / name)
        picture = root / "NOOP.png"
        png(picture)
        screen_config = root / "screenrc"
        screen_config.write_text("startup_message off\n")

        for inherited in (False, True):
            label = "inherited-owner" if inherited else "clean"
            session = identity + "-" + label
            window = None
            wire = root / (label + ".ansi")
            env = [
                "--env", "PATH=" + os.environ["PATH"],
                "--env", "PYTHONDONTWRITEBYTECODE=1",
                "--env", "TMUX", "--env", "TMUX_PANE", "--env", "__tmux_popup_name",
                "--env", "YAZI_KITTY_SOCKET", "--env", "YAZI_KITTY_HELPER",
                "--env", "YAZI_CONFIG_HOME=" + str(config),
                "--env", "YAZI_CACHE_HOME=" + str(root / (label + "-cache")),
            ]
            if inherited:
                env += [
                    "--env", "YAZI_KITTY_SOCKET=" + str(root / "exited-owner"),
                    "--env", "YAZI_KITTY_HELPER=" + str(plugin / "main.py"),
                ]
            try:
                window = kitty(
                    "launch", "--type=os-window", "--keep-focus", "--title=" + session,
                    *env, screen, "-S", session, "-c", str(screen_config),
                    "/usr/bin/script", "-q", str(wire), yazi, str(picture),
                )
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    visible = kitty("get-text", "--match", "id:" + window)
                    if "NOOP.png" in visible:
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError("GNU Screen did not show the selected fixture: " + repr(visible[-2000:]))
                # Allow native capability probes and the preview worker to finish.
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    visible = kitty("get-text", "--match", "id:" + window)
                    if "Kitty preview:" in visible:
                        break
                    time.sleep(0.1)
                passed = "Kitty preview:" not in visible
                error_lines = [line.strip() for line in visible.splitlines() if "Kitty preview:" in line]
                results.append({"case": label, "multiplexer": "GNU Screen", "native_delegation": passed,
                                "preview_errors": error_lines})
            finally:
                # The session name is unique and belongs only to this test.
                subprocess.run([screen, "-S", session, "-X", "quit"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=12)
                if window:
                    subprocess.run(["kitty", "@", "--to", opts.kitty_to, "close-window", "--match", "id:" + window],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
    print(json.dumps({"cases": results}, indent=2))
    assert all(case["native_delegation"] for case in results), "custom preview interfered with native GNU Screen rendering"


if __name__ == "__main__":
    main()
