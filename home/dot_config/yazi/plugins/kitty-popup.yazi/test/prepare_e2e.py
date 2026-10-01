#!/usr/bin/env python3
"""Reset only the recorded test popup; exercise the managed tmux hook syntax."""

import argparse
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True
from e2e import SOURCE, command

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--state-root", required=True, type=pathlib.Path)
parser.add_argument("--plugin-source", type=pathlib.Path, default=SOURCE)
parser.add_argument("--toggle-config", type=pathlib.Path)
opts = parser.parse_args()
root = opts.state_root.resolve()
identity = (root / "id").read_text().strip()
window = (root / "window").read_text().strip()
if not identity.startswith("yazi-kitty-hardening-") or not root.name.startswith(identity + "."):
    raise ValueError("not a recorded test context")
source = opts.plugin_source.resolve()
yazi_source = source.parent.parent
session = f"={identity}/{identity}/yazi_pwd"
inner = ["tmux", "-L", identity + "-inner"]
existing = subprocess.run([*inner, "list-panes", "-s", "-t", session, "-F", "#{pane_id} #{@yazi-kitty-socket}"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
if existing.returncode == 0:
    pane, endpoint = existing.stdout.strip().split(maxsplit=1)
    if not endpoint.startswith(f"/tmp/ykp-{os.getuid()}-"):
        raise ValueError("test popup is not owned by this preview helper")
    command(*inner, "send-keys", "-t", pane, "q")
    deadline = time.monotonic() + 8
    while pathlib.Path(endpoint).parent.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    if pathlib.Path(endpoint).parent.exists():
        raise AssertionError("test-owned frontend did not exit cleanly")

for name in ("main.lua", "main.py", "preview.py"):
    shutil.copyfile(source / name, root / "yazi/plugins/kitty-popup.yazi" / name)
for name in ("yazi.toml", "init.lua"):
    shutil.copyfile(yazi_source / name, root / "yazi" / name)
helper = str(source / "main.py")
toggle_config = opts.toggle_config or yazi_source.parent / "tmux/plugins/toggle-popup.conf"
config = toggle_config.read_text().replace("~/.config/yazi/plugins/kitty-popup.yazi/main.py", helper)
config = config.replace("-d '##{pane_current_path}' -E 'python3 " + helper + " run'", "-d '" + str(root / "images") + "' -E '/usr/bin/env YAZI_CONFIG_HOME=" + str(root / "yazi") + " YAZI_CACHE_HOME=" + str(root / "cache") + " python3 " + helper + " run " + str(root / "images/IMAGE.png") + "'")
config_path = root / "managed-toggle-popup.conf"
config_path.write_text(config)
command("tmux", "-L", identity, "source-file", str(config_path))
command(*inner, "set-hook", "-gu", "client-attached[20261001]")
command("kitty", "@", "send-key", "--match", "id:" + window, "alt+y")
deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    check = subprocess.run([*inner, "list-panes", "-s", "-t", session, "-F", "#{@yazi-kitty-socket}"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    if check.returncode == 0 and check.stdout.strip().startswith(f"/tmp/ykp-{os.getuid()}-"):
        break
    time.sleep(0.05)
else:
    raise AssertionError("managed popup launcher did not start")
hooks = command(*inner, "show-hooks", "-g")
if "client-attached[20261001]" in config:
    if "client-attached[20261001]" not in hooks:
        raise AssertionError("baseline attach hook is missing: " + hooks)
else:
    if "client-attached[20261001]" in hooks:
        raise AssertionError("legacy global attach hook is still installed: " + hooks)
    callback = command("tmux", "-L", identity, "show-options", "-gv", "@popup-on-init")
    if "if-shell -F" not in callback or '@yazi-kitty-socket' not in callback or 'main.py refresh' not in callback:
        raise AssertionError("managed popup-open callback is missing: " + callback)
print("Managed launcher and popup refresh callback loaded in the isolated server.")
