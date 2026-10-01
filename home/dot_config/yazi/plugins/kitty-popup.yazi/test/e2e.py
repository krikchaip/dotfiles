#!/usr/bin/env python3
"""Drive a test-owned Kitty window and tmux servers using the real popup keys.

Requires a prepared state-root with id/window files, images/, and a copy of the
user's Yazi config in yazi/. Refuses non-test server names and unrelated windows.
This checks real terminal cells and lifecycle, not screenshot pixel appearance.
"""

import argparse
import json
import os
import pathlib
import random
import re
import struct
import subprocess
import sys
import time
import unicodedata
import zlib

sys.dont_write_bytecode = True
SOURCE = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SOURCE))
from main import rpc

PLACEHOLDER = chr(0x10EEEE)


def check_prepared_config(root, plugin_source=None):
    expected = plugin_source or SOURCE
    pairs = [(expected / name, root / "yazi/plugins/kitty-popup.yazi" / name)
             for name in ("main.lua", "main.py", "preview.py")]
    pairs += [(expected.parent.parent / name, root / "yazi" / name)
              for name in ("init.lua", "yazi.toml")]
    for source, prepared in pairs:
        if not prepared.is_file() or prepared.read_bytes() != source.read_bytes():
            raise ValueError(f"stale prepared config: {prepared.name}; run prepare_e2e.py first")


def command(*args, env=None):
    return subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=12, check=True).stdout.strip()


def eventually(label, check, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError(f"timed out: {label}")


def make_png(path, width, height, pixels):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", type=pathlib.Path, required=True)
    parser.add_argument("--plugin-source", type=pathlib.Path)
    opts = parser.parse_args()
    root = opts.state_root.resolve()
    identity = (root / "id").read_text().strip()
    window = (root / "window").read_text().strip()
    if not re.fullmatch(r"yazi-kitty-hardening-\d{8}-\d{6}", identity) or not root.name.startswith(identity + "."):
        raise ValueError("not an owned Yazi test context")
    check_prepared_config(root, opts.plugin_source)
    windows = json.loads(command("kitty", "@", "ls"))
    target = next(w for group in windows for tab in group["tabs"] for w in tab["windows"] if str(w["id"]) == window)
    if not any(identity in p["cmdline"] for p in target["foreground_processes"]):
        raise ValueError("Kitty window does not run the owned test server")

    def tmux(inner, *args):
        return command("tmux", "-L", identity + ("-inner" if inner else ""), *args)

    def text(native=None):
        return command("kitty", "@", "get-text", "--match", "id:" + (native or window))

    def key(value, native=None):
        command("kitty", "@", "send-key", "--match", "id:" + (native or window), value)

    session = f"={identity}/{identity}/yazi_pwd"
    endpoint = tmux(True, "list-panes", "-s", "-t", session, "-F", "#{@yazi-kitty-socket}")
    pane = tmux(True, "list-panes", "-s", "-t", session, "-F", "#{pane_id}")
    if not endpoint.startswith(f"/tmp/ykp-{os.getuid()}-"):
        raise ValueError("popup has no private image owner")

    def status():
        return rpc(endpoint, {"action": "status"})

    def ready():
        value = status()
        screen = text()
        assert "Kitty preview:" not in screen, screen[-2000:]
        assert "SIXEL IMAGE" not in screen
        return value if value["image_id"] and not value["encoding"] and PLACEHOLDER in screen else None

    results = []
    initial = eventually("initial native image", ready)
    original_pid = initial["pid"]
    expected_cells = list(map(int, tmux(False, "display-message", "-p", "#{client_cell_width} #{client_cell_height}").split()))
    assert initial["cells"] == expected_cells and initial["owned"] == 1, initial
    results.append({"case": "initial", "pid": original_pid, "cells": initial["cells"], "placeholders": text().count(PLACEHOLDER)})

    native_window = None
    binding = next(line for line in tmux(False, "list-keys", "-T", "root").splitlines() if line.split()[1:4] == ["-T", "root", "M-y"])
    restore_binding = root / "restore-binding.conf"
    resize_binding = root / "resize-binding.conf"
    restore_binding.write_text(binding + "\n")
    assert "-w 80%" in binding
    resize_binding.write_text(binding.replace("-w 80%", "-w 40%") + "\n")
    try:
        for cycle in range(3):
            before = status()["serial"]
            key("ctrl+z")
            eventually("hidden caller has no image cells", lambda: PLACEHOLDER not in text())
            assert status()["pid"] == original_pid
            key("alt+y")
            after = eventually("same-process reattach and forced redraw", lambda: (s if (s := ready()) and s["serial"] > before else None))
            assert after["pid"] == original_pid and after["owned"] == 1
            assert "IMAGE.png" in text()
        results.append({"case": "hide/reopen", "cycles": 3, "same_pid": True, "fresh_preview": True})

        before_resize = status()["serial"]
        original_geometry = tmux(True, "display-message", "-p", "-t", pane, "#{pane_width} #{pane_height}")
        key("ctrl+z")
        eventually("hidden before resize", lambda: PLACEHOLDER not in text())
        tmux(False, "source-file", str(resize_binding))
        key("alt+y")
        changed = eventually("resize triggers a fresh preview", lambda: (s if (s := ready()) and s["serial"] > before_resize and tmux(True, "display-message", "-p", "-t", pane, "#{pane_width} #{pane_height}") != original_geometry else None))
        physical = list(map(int, tmux(False, "display-message", "-p", "#{client_cell_width} #{client_cell_height}").split()))
        assert changed["cells"] == physical
        capture = tmux(True, "capture-pane", "-p", "-t", pane)
        width, height = map(int, tmux(True, "display-message", "-p", "-t", pane, "#{pane_width} #{pane_height}").split())
        occupied = []
        for y, line in enumerate(capture.splitlines()):
            x = 0
            for character in line:
                if character == PLACEHOLDER:
                    occupied.append((x, y))
                if not unicodedata.combining(character):
                    x += 2 if unicodedata.east_asian_width(character) in "WF" else 1
        assert occupied and all(width // 2 < x < width and 0 < y < height - 1 for x, y in occupied), (width, height, occupied[:3])
        results.append({"case": "resize", "cells": physical, "image_cells_inside_preview": True})
        key("ctrl+z")
        eventually("hidden before size restore", lambda: PLACEHOLDER not in text())
        tmux(False, "source-file", str(restore_binding))
        key("alt+y")
        eventually("default-size redraw", lambda: ready() and tmux(True, "display-message", "-p", "-t", pane, "#{pane_width} #{pane_height}") == original_geometry)

        pictures = root / "images"
        tiny = pictures / "02 tiny; $(literal).png"
        transparent = pictures / "03 transparent.png"
        noise = pictures / "04 noise.png"
        plain = pictures / "05 text.txt"
        make_png(tiny, 9, 7, bytes((30, 200, 80, 255)) * 63)
        make_png(transparent, 120, 80, bytes((210, 80, 20, 90)) * 9600)
        make_png(noise, 900, 600, random.Random(42).randbytes(900 * 600 * 4))
        plain.write_text("Text preview must have no image cells.\n")
        frontend_id = initial["frontend_id"]

        def reveal(path):
            command("ya", "emit-to", frontend_id, "reveal", str(path))

        cell_width, cell_height = expected_cells
        for path, pixels_wide, pixels_high in ((tiny, 9, 7), (transparent, 120, 80), (noise, 900, 600)):
            expected_count = ((pixels_wide + cell_width - 1) // cell_width) * ((pixels_high + cell_height - 1) // cell_height)
            before = status()["serial"]
            reveal(path)
            value = eventually("fresh image with no old cells: " + path.name, lambda: (s if (s := ready()) and s["serial"] > before and text().count(PLACEHOLDER) == expected_count else None))
            assert value["owned"] == 1 and value["pid"] == original_pid
            results.append({"case": path.name, "placeholders": text().count(PLACEHOLDER), "owned_images": value["owned"]})
        for _ in range(10):
            reveal(noise)
            reveal(tiny)
            reveal(transparent)
        reveal(plain)
        try:
            eventually("rapid changes end on text without stale image cells", lambda: "Text preview must have no image cells." in text() and PLACEHOLDER not in text())
        except AssertionError as error:
            visible = text()
            raise AssertionError(f"{error}; text_visible={'Text preview must have no image cells.' in visible}; placeholders={visible.count(PLACEHOLDER)}; inner_cells={tmux(True, 'capture-pane', '-p', '-t', pane).count(PLACEHOLDER)}; owner={status()}; screen={visible[-2200:]!r}") from error
        final = status()
        assert final["owned"] == 0 and final["path"] is None and final["clear_requests"] > 0 and final["pid"] == original_pid, final
        results.append({"case": "rapid switching", "changes": 31, "final_text_has_no_image_cells": True,
                        "owned_images": final["owned"], "cleanup_requests": final["clear_requests"]})
        key("q")
        eventually("normal-exit private state cleanup", lambda: not pathlib.Path(endpoint).parent.exists())
        try:
            os.kill(original_pid, 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError("Yazi remained alive after normal quit")
        results.append({"case": "normal exit", "no_private_state": True, "no_frontend_process": True})

        native_log = root / "native.ansi"
        native_window = command(
            "kitty", "@", "launch", "--type=os-window", "--keep-focus", "--title=Yazi native no-tmux check",
            "--env", "TMUX", "--env", "TMUX_PANE", "--env", "__tmux_popup_name",
            "--env", "YAZI_KITTY_SOCKET", "--env", "YAZI_KITTY_HELPER",
            "--env", "YAZI_CONFIG_HOME=" + str(root / "yazi"),
            "--env", "YAZI_CACHE_HOME=" + str(root / "cache-native"),
            "/usr/bin/script", "-q", str(native_log), command("which", "yazi"), str(pictures / "IMAGE.png"),
        )
        eventually("native Kitty renderer without tmux", lambda: PLACEHOLDER in text(native_window))
        wire = native_log.read_bytes()
        assert b"\x1b_G" in wire and b"\x1bPtmux;" not in wire
        assert not re.search(rb"\x1bP[0-9;]*q", wire)
        results.append({"case": "no tmux", "native_kitty_packets": True, "tmux_envelopes": False, "placeholders": text(native_window).count(PLACEHOLDER)})
        key("q", native_window)
        print(json.dumps({"result": "pass", "cases": results}, indent=2))
    finally:
        tmux(False, "source-file", str(restore_binding))
        if native_window:
            subprocess.run(["kitty", "@", "close-window", "--match", "id:" + native_window], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
