#!/usr/bin/env python3
"""Image previews in a Herdr toggle popup: the client of the popup's proxy.

Herdr does not show images to the viewer of a toggle popup, so the popup's
proxy draws them (home/dot_config/herdr/toggle-popup/images.py). main.lua
runs this helper when TOGGLE_POPUP_IMAGE_SOCKET names the proxy's socket:

  herdr.py show HOVER FILE IMAGE CACHE X Y W H MAX_W MAX_H
      Send IMAGE, a preview of FILE, for the area X, Y, W, H in cells. IMAGE
      is what yazi's preset preloader made (an SVG rendered by resvg, for
      example), or FILE. The proxy takes PNG only, at most MAX_W x MAX_H
      pixels: when neither IMAGE nor FILE is such a PNG, IMAGE first becomes
      the PNG CACHE-herdr.png (ImageMagick).
  herdr.py clear HOVER FILE
      The cursor moved to FILE.

HOVER counts yazi's hover changes, so the proxy can drop a late show. The
output is one JSON line: the proxy's reply, {"absent": true} when no proxy
listens (the popup is hidden), or {"error": TEXT}.

It runs on any Python 3: yazi runs the first python3 on PATH.
"""

from __future__ import annotations

import json
import os
import pathlib
import socket
import stat
import struct
import subprocess
import sys

SOCKET_ENV = "TOGGLE_POPUP_IMAGE_SOCKET"
SIGNATURE = b"\x89PNG\r\n\x1a\n"
# The same limit as the proxy's.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REPLY = 4 * 1024 * 1024
# A request waits while the proxy starts or shows a page.
REPLY_SECONDS = 5
CONVERT_SECONDS = 30


class Absent(Exception):
    """No proxy listens on the socket."""


def png_size(path: pathlib.Path) -> tuple[int, int] | None:
    """The (width, height) of a PNG file, or None for another file."""
    with open(path, "rb") as stream:
        head = stream.read(24)
    if not head.startswith(SIGNATURE) or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def fitting_png(path: pathlib.Path, max_size: tuple[int, int]) -> bool:
    """True when `path` is a PNG that the proxy takes as it is."""
    try:
        size = png_size(path)
        return (size is not None and path.stat().st_size <= MAX_IMAGE_BYTES
                and size[0] <= max_size[0] and size[1] <= max_size[1])
    except OSError:
        return False


def preview_png(image: pathlib.Path, cache: str, max_size: tuple[int, int],
                file: pathlib.Path | None = None) -> pathlib.Path:
    """A PNG of `image` that the proxy can send: the image itself, the
    previewed `file` when it is a PNG that fits (yazi's image preloader keeps
    a copy that is not a PNG), or a PNG that ImageMagick makes in the cache."""
    for candidate in (image, file):
        if candidate is not None and fitting_png(candidate, max_size):
            return candidate
    if not cache:
        raise ValueError("yazi has no cache path for this image")
    target = pathlib.Path(f"{cache}-herdr.png")
    try:
        if target.stat().st_mtime >= image.stat().st_mtime:
            return target
    except FileNotFoundError:
        pass
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    command = ["magick", f"{image}[0]", "-auto-orient",
               "-resize", f"{max_size[0]}x{max_size[1]}>", f"PNG32:{temporary}"]
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE, timeout=CONVERT_SECONDS)
    except FileNotFoundError:
        raise ValueError("this image needs ImageMagick (magick)") from None
    except subprocess.TimeoutExpired:
        temporary.unlink(missing_ok=True)
        raise ValueError("ImageMagick took too long") from None
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        text = result.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(text[-1] if text else "ImageMagick cannot read this image")
    os.replace(temporary, target)
    return target


def checked_socket(value: str) -> str:
    """The proxy's socket, when only this user can reach it."""
    path = pathlib.Path(value)
    try:
        folder, endpoint = path.parent.lstat(), path.lstat()
    except FileNotFoundError:
        raise Absent() from None
    if (not stat.S_ISDIR(folder.st_mode) or folder.st_uid != os.getuid()
            or stat.S_IMODE(folder.st_mode) != 0o700
            or not stat.S_ISSOCK(endpoint.st_mode) or endpoint.st_uid != os.getuid()):
        raise ValueError("the image socket is not private")
    return str(path)


def send(request: dict) -> dict:
    value = os.environ.get(SOCKET_ENV, "")
    if not value:
        raise Absent()
    path = checked_socket(value)
    with socket.socket(socket.AF_UNIX) as peer:
        peer.settimeout(REPLY_SECONDS)
        try:
            peer.connect(path)
            peer.sendall(json.dumps(request).encode() + b"\n")
            reply = b""
            while not reply.endswith(b"\n"):
                block = peer.recv(65536)
                if not block:
                    break
                reply += block
                if len(reply) > MAX_REPLY:
                    raise ValueError("the proxy's reply is too large")
        except (ConnectionRefusedError, FileNotFoundError, socket.timeout):
            # A proxy that is gone, or busy on a page, draws nothing now.
            raise Absent() from None
    if not reply:
        raise Absent()
    return json.loads(reply)


def main(argv: list[str]) -> int:
    try:
        action, args = argv[0], argv[1:]
        if action == "show":
            hover, file, image, cache, x, y, w, h, max_w, max_h = args
            path = preview_png(pathlib.Path(image), cache, (int(max_w), int(max_h)),
                               pathlib.Path(file))
            request = {"action": "show", "file": file, "path": str(path), "x": int(x),
                       "y": int(y), "w": int(w), "h": int(h), "hover": int(hover)}
        elif action == "clear":
            hover, file = args
            request = {"action": "clear", "file": file, "hover": int(hover)}
        else:
            raise ValueError(f"unknown action: {action}")
        reply = send(request)
    except Absent:
        reply = {"absent": True}
    except (IndexError, OSError, ValueError) as error:
        reply = {"error": str(error)}
    print(json.dumps(reply, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
