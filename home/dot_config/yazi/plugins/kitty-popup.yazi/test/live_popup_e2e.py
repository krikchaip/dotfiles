#!/usr/bin/env python3
"""Create and clean a live popup context with the user's real configuration.

Restore/save are disabled before TPM starts. No existing tmux server or Kitty
window is driven. Optionally check a real GIF before the full lifecycle gate.
"""

import argparse
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
from e2e import PLACEHOLDER, SOURCE, command, eventually, make_png
from main import rpc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kitty-to", required=True)
    parser.add_argument("--gif", type=pathlib.Path)
    parser.add_argument("--video", action="store_true", help="check video thumbnails, seeking, and popup reattach")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--baseline", action="store_true", help="read-only comparison against the installed plugin and callback")
    opts = parser.parse_args()
    plugin_source = pathlib.Path.home() / ".config/yazi/plugins/kitty-popup.yazi" if opts.baseline else SOURCE
    os.environ["KITTY_LISTEN_ON"] = opts.kitty_to
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    identity = "yazi-kitty-hardening-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    servers = [identity, identity + "-inner"]
    env = dict(os.environ)
    for name in ("TMUX", "TMUX_PANE", "__tmux_popup_name", "__tmux_popup_caller", "YAZI_KITTY_HELPER", "YAZI_KITTY_SOCKET"):
        env.pop(name, None)
    for server in servers:
        existing = subprocess.run(["tmux", "-N", "-L", server, "list-sessions"], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if existing.returncode == 0:
            raise ValueError("test server identity already exists")

    window = None
    started = []
    with tempfile.TemporaryDirectory(prefix=identity + ".", dir="/tmp") as directory:
        root = pathlib.Path(directory)
        (root / "id").write_text(identity)
        images = root / "images"
        images.mkdir()
        make_png(images / "IMAGE.png", 960, 640, bytes((30, 200, 80, 255)) * (960 * 640))
        config = root / "yazi"
        shutil.copytree(pathlib.Path.home() / ".config/yazi", config,
                        ignore=shutil.ignore_patterns("__pycache__", "test"))
        if opts.gif:
            shutil.copyfile(opts.gif, images / "user.gif")

        # Keep the real config, but disable restore/save before its TPM command.
        plugins = (pathlib.Path.home() / ".config/tmux/plugins/plugins.conf").read_text()
        tpm = 'run "~/.tmux/plugins/tpm/tpm"'
        if plugins.count(tpm) != 1:
            raise ValueError("cannot safely disable test-server automatic restore")
        plugins = plugins.replace(tpm, 'set -g @continuum-restore off\nset -g @continuum-save-interval 0\n'
                                  + 'set -g @resurrect-dir "' + str(root / "resurrect") + '"\n' + tpm)
        (root / "plugins.conf").write_text(plugins)
        base = (pathlib.Path.home() / ".config/tmux/tmux.conf").read_text()
        original = 'source "~/.config/tmux/plugins/plugins.conf"'
        if base.count(original) != 1:
            raise ValueError("cannot isolate the real tmux plugin configuration")
        (root / "tmux.conf").write_text(base.replace(original, 'source "' + str(root / "plugins.conf") + '"'))
        try:
            for server in servers:
                command("tmux", "-L", server, "-f", str(root / "tmux.conf"), "new-session", "-d", "-s",
                        identity if server == identity else identity + "-bootstrap", "-x", "282", "-y", "79",
                        "-c", str(images), "/usr/bin/tail -f /dev/null", env=env)
                started.append(server)
                command("tmux", "-L", server, "set-option", "-g", "@popup-socket-name", identity + "-inner")
                assert command("tmux", "-L", server, "show-options", "-gv", "@continuum-restore") == "off"
                assert command("tmux", "-L", server, "show-options", "-gv", "@continuum-save-interval") == "0"
            window = command("kitty", "@", "launch", "--type=os-window", "--keep-focus", "--title=" + identity,
                             "--env", "TMUX", "--env", "TMUX_PANE", "--env", "__tmux_popup_name",
                             "--env", "PATH=" + os.environ["PATH"],
                             "/usr/bin/script", "-q", str(root / "outer.ansi"),
                             shutil.which("tmux"), "-L", identity, "attach-session", "-t", "=" + identity)
            (root / "window").write_text(window)
            eventually("attached test client", lambda: command("tmux", "-L", identity, "list-clients"))
            for server in servers:
                command("tmux", "-L", server, "set-environment", "-g", "KITTY_WINDOW_ID", window)
            prepare_args = ["--state-root", str(root), "--plugin-source", str(plugin_source)]
            if opts.baseline:
                prepare_args += ["--toggle-config", str(pathlib.Path.home() / ".config/tmux/plugins/toggle-popup.conf")]
            command(sys.executable, str(SOURCE / "test/prepare_e2e.py"), *prepare_args)
            session = "=" + identity + "/" + identity + "/yazi_pwd"
            endpoint = eventually("image-owner endpoint", lambda: command(
                "tmux", "-L", identity + "-inner", "list-panes", "-s", "-t", session, "-F", "#{@yazi-kitty-socket}"))

            def text():
                return command("kitty", "@", "get-text", "--match", "id:" + window)

            def ready():
                state = rpc(endpoint, {"action": "status"})
                visible = text()
                assert "Kitty preview:" not in visible, "\n".join(line.strip() for line in visible.splitlines() if "Kitty preview:" in line)
                return state if state["image_id"] and not state["encoding"] and PLACEHOLDER in visible else None

            initial = eventually("initial PNG preview", ready)
            if opts.gif and not opts.baseline:
                command("ya", "emit-to", initial["frontend_id"], "reveal", str(images / "user.gif"))
                state = eventually("real GIF preview", lambda: (
                    current if (current := ready()) and current["serial"] > initial["serial"]
                    and current["image_id"] != initial["image_id"] else None))
                print(json.dumps({"case": "user GIF", "result": "pass", "owned": state["owned"]}), flush=True)
                command("ya", "emit-to", initial["frontend_id"], "reveal", str(images / "IMAGE.png"))
                eventually("PNG restored", lambda: (current if (current := ready()) and current["serial"] > state["serial"] else None))
            if opts.video:
                movie = images / "Screen recording.mov"
                command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                        "-i", "color=c=red:s=320x180:d=2", "-f", "lavfi",
                        "-i", "color=c=blue:s=320x180:d=2", "-filter_complex",
                        "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "mpeg4", "-g", "10", str(movie))
                command("ya", "emit-to", initial["frontend_id"], "reveal", str(movie))

                def video_ready(previous):
                    screen = text()
                    assert "SIXEL IMAGE" not in screen, "Video preview emitted SIXEL IMAGE text instead of a thumbnail"
                    state = ready()
                    return state if state and state["image_id"] != previous["image_id"] else None

                video = eventually("video thumbnail", lambda: video_ready(initial))
                assert video["path"] == str(movie), video
                command("ya", "emit-to", initial["frontend_id"], "seek", "50")
                sought = eventually("video seek thumbnail", lambda: video_ready(video))
                assert sought["path"] == str(movie), sought
                command("kitty", "@", "send-key", "--match", "id:" + window, "ctrl+z")
                eventually("hidden video has no image cells", lambda: PLACEHOLDER not in text())
                command("kitty", "@", "send-key", "--match", "id:" + window, "alt+y")
                reopened = eventually("video thumbnail after reattach", lambda: video_ready(sought))
                assert reopened["pid"] == initial["pid"] and reopened["path"] == str(movie), reopened
                plain = images / "video-cleanup.txt"
                plain.write_text("Video preview cleanup.\n")
                command("ya", "emit-to", initial["frontend_id"], "reveal", str(plain))
                eventually("video to text clears image cells",
                           lambda: "Video preview cleanup." in text() and PLACEHOLDER not in text())
                assert rpc(endpoint, {"action": "status"})["owned"] == 0
                print(json.dumps({"case": "video", "result": "pass", "seek": True,
                                  "reattach": True, "text_cleanup": True}), flush=True)
                command("ya", "emit-to", initial["frontend_id"], "reveal", str(images / "IMAGE.png"))
                eventually("PNG restored after video", ready)
            if opts.full:
                result = subprocess.run([
                    sys.executable, str(SOURCE / "test/e2e.py"), "--state-root", str(root),
                    "--plugin-source", str(plugin_source),
                ], env=os.environ, timeout=100)
                if result.returncode:
                    raise AssertionError("full live lifecycle gate failed")
        finally:
            for server in reversed(started):
                subprocess.run(["tmux", "-L", server, "kill-server"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10)
            if window:
                subprocess.run(["kitty", "@", "close-window", "--match", "id:" + window],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


if __name__ == "__main__":
    main()
