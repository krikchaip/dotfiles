"""Herdr mode: herdr.py sends image previews to the toggle-popup proxy."""

import json
import os
import pathlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zlib

HELPER = pathlib.Path(__file__).resolve().parent.parent / "herdr.py"
SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png(width, height):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + b"\x00\x80\xff" * width for _ in range(height))
    return (SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def png_size(path):
    data = pathlib.Path(path).read_bytes()
    assert data.startswith(SIGNATURE), path
    return struct.unpack(">II", data[16:24])


class FakeProxy:
    """The proxy's image socket: it keeps each request and gives `reply`."""

    def __init__(self, path, reply):
        self.requests = []
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(str(path))
        os.chmod(path, 0o600)
        self.server.listen(4)
        self.reply = reply
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while True:
            try:
                peer, _ = self.server.accept()
            except OSError:
                return
            with peer:
                line = peer.makefile("rb").readline()
                self.requests.append(json.loads(line))
                peer.sendall(json.dumps(self.reply).encode() + b"\n")

    def close(self):
        self.server.close()


class Helper(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp(prefix="ykh", dir="/tmp")
        self.addCleanup(shutil.rmtree, folder, True)
        self.folder = pathlib.Path(folder)
        self.sockets = self.folder / "images"
        self.sockets.mkdir(mode=0o700)
        self.socket = self.sockets / "a3f9c2.sock"
        self.reply = {"rows": ["r"], "color": "#a3f9c2"}

    def proxy(self):
        proxy = FakeProxy(self.socket, self.reply)
        self.addCleanup(proxy.close)
        return proxy

    def run_helper(self, *args):
        env = dict(os.environ, TOGGLE_POPUP_IMAGE_SOCKET=str(self.socket))
        result = subprocess.run([sys.executable, str(HELPER), *map(str, args)], env=env,
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def show(self, image, cache="", max_size=(600, 900)):
        return self.run_helper("show", 3, "/files/x.png", image, cache, 4, 2, 50, 20, *max_size)

    def test_a_small_png_goes_as_it_is(self):
        proxy = self.proxy()
        image = self.folder / "a.png"
        image.write_bytes(png(40, 20))
        self.assertEqual(self.show(image), self.reply)
        self.assertEqual(proxy.requests, [{
            "action": "show", "file": "/files/x.png", "path": str(image), "x": 4, "y": 2,
            "w": 50, "h": 20, "hover": 3}])

    def test_a_png_file_goes_as_it_is_when_its_preview_copy_is_not_a_png(self):
        # yazi's image preloader keeps a smaller copy that is not a PNG. A PNG
        # file that fits needs no ImageMagick: a remote machine may not have it.
        proxy = self.proxy()
        original = self.folder / "a.png"
        original.write_bytes(png(40, 20))
        copy = self.folder / "cache-a"
        copy.write_bytes(b"\xff\xd8\xff\xe0 a JPEG")
        self.assertEqual(self.run_helper("show", 3, original, copy, copy, 4, 2, 50, 20, 600, 900),
                         self.reply)
        self.assertEqual(proxy.requests[-1]["path"], str(original))

    def test_a_clear_names_the_hovered_file(self):
        proxy = self.proxy()
        self.reply = {"cleared": True}
        proxy.reply = self.reply
        self.assertEqual(self.run_helper("clear", 7, "/files/b.txt"), {"cleared": True})
        self.assertEqual(proxy.requests, [{"action": "clear", "file": "/files/b.txt",
                                           "hover": 7}])

    def test_without_a_proxy_nothing_shows(self):
        image = self.folder / "a.png"
        image.write_bytes(png(4, 4))
        self.assertEqual(self.show(image), {"absent": True})
        self.assertEqual(self.run_helper("clear", 1, "/files/b.txt"), {"absent": True})

    def test_a_socket_that_others_can_reach_is_refused(self):
        self.proxy()
        self.sockets.chmod(0o755)
        image = self.folder / "a.png"
        image.write_bytes(png(4, 4))
        self.assertIn("error", self.show(image))

    def test_another_image_without_a_cache_path_is_an_error(self):
        self.proxy()
        image = self.folder / "a.gif"
        image.write_bytes(b"GIF89a")
        self.assertIn("error", self.show(image))

    @unittest.skipUnless(shutil.which("magick"), "needs ImageMagick")
    def test_a_large_png_and_a_jpeg_become_a_small_png_in_the_cache(self):
        proxy = self.proxy()
        large = self.folder / "large.png"
        large.write_bytes(png(1200, 300))
        jpeg = self.folder / "photo.jpg"
        subprocess.run(["magick", "-size", "90x60", "xc:red", str(jpeg)], check=True)
        for image, size in ((large, (600, 150)), (jpeg, (90, 60))):
            with self.subTest(image=image.name):
                cache = self.folder / f"cache-{image.stem}"
                self.assertEqual(self.show(image, cache), self.reply)
                path = proxy.requests[-1]["path"]
                self.assertEqual(path, f"{cache}-herdr.png")
                self.assertEqual(png_size(path), size)
        # The cached PNG is used again.
        before = os.stat(f"{self.folder / 'cache-photo'}-herdr.png").st_mtime_ns
        self.show(jpeg, self.folder / "cache-photo")
        self.assertEqual(os.stat(f"{self.folder / 'cache-photo'}-herdr.png").st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
