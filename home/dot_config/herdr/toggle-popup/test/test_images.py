"""Yazi image previews in a popup: images.py."""

import base64
import json
import os
import re
import select
import socket
import stat
import struct
import sys
import tempfile
import threading
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import images


def png(width=40, height=20):
    """A real PNG of one color."""
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (images.PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2,
                                                               0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def packets(data):
    """Each kitty graphics command in `data`: (control keys, payload)."""
    found = []
    for control, payload in re.findall(rb"\x1b_G([^;\x1b]*);?([^\x1b]*)\x1b\\", data):
        keys = dict(item.split(b"=", 1) for item in control.split(b","))
        found.append(({key.decode(): value.decode() for key, value in keys.items()}, payload))
    return found


class FakeScreen:
    """The popup terminal: what the proxy wrote, its size and its cell size."""

    def __init__(self, rows=30, cols=100, cell=(10, 20)):
        self.written = []
        self.rows, self.cols, self.cell = rows, cols, cell
        self.output = images.Output()

    def show(self, data):
        self.written.append(data)
        self.output.feed(data)

    def size(self):
        return self.rows, self.cols

    def cell_size(self):
        return self.cell

    def take(self):
        data, self.written = b"".join(self.written), []
        return data


class Output(unittest.TestCase):
    def test_a_write_is_safe_only_between_sequences_and_characters(self):
        output = images.Output()
        for data, safe in ((b"text", True), (b"\x1b[3", False), (b"8;2;1;2;3m", True),
                           (b"\x1b]8;;http://x", False), (b"\x07link", True),
                           ("é".encode()[:1], False), ("é".encode()[1:], True),
                           (b"\x1b", False), (b"7", True), (b"\x1b_Gq=2", False),
                           (b";AAAA\x1b", False), (b"\\", True), (b"\x1b(", False),
                           (b"B", True)):
            output.feed(data)
            self.assertEqual(output.safe, safe, data)

    def test_screen_clears_and_screen_switches_count_as_erasures(self):
        output = images.Output()
        for data in (b"\x1b[2J", b"\x1b[?1049h", b"\x1b[?1049l", b"\x1b[?1047h", b"\x1b[?47l",
                     b"\x1bc", b"\x1b[3J"):
            before = output.erasures
            output.feed(b"a" + data + b"b")
            self.assertEqual(output.erasures, before + 1, data)
        before = output.erasures
        output.feed(b"\x1b[J\x1b[1J\x1b[K\x1b[2K\x1b[?25h\x1b[?2026h")
        self.assertEqual(output.erasures, before)

    def test_an_erasure_split_over_two_writes_counts_once(self):
        output = images.Output()
        output.feed(b"x\x1b[?10")
        output.feed(b"49hy")
        output.feed(b"z")
        self.assertEqual(output.erasures, 1)


class Placement(unittest.TestCase):
    def test_the_image_fits_the_area_and_keeps_its_shape(self):
        # 400x200 px in 10x20 px cells: 40x10 cells.
        self.assertEqual(images.placement((400, 200), (50, 20), (10, 20)), (40, 10))
        # Too wide: 100 columns are the limit.
        self.assertEqual(images.placement((2000, 200), (100, 20), (10, 20)), (100, 5))
        # Too tall.
        self.assertEqual(images.placement((100, 2000), (100, 20), (10, 20)), (2, 20))

    def test_a_small_image_is_not_made_larger(self):
        self.assertEqual(images.placement((15, 15), (50, 20), (10, 20)), (2, 1))

    def test_rows_of_placeholders_name_their_row_and_column(self):
        rows = images.placeholder_rows(3, 2)
        self.assertEqual(len(rows), 2)
        first = images.PLACEHOLDER + chr(0x0305)
        self.assertEqual(rows[0], "".join(first + chr(column) for column in
                                          (0x0305, 0x030D, 0x030E)))
        self.assertTrue(rows[1].startswith(images.PLACEHOLDER + chr(0x030D) + chr(0x0305)))

    def test_the_image_id_is_the_popup_id_and_the_color_names_it(self):
        self.assertEqual(images.image_id("a3f9c2"), 0xA3F9C2)
        self.assertEqual(images.image_id("000000"), 1)
        self.assertEqual(images.color(0xA3F9C2), "#a3f9c2")

    def test_the_upload_is_inline_png_in_chunks(self):
        data = png(300, 300)
        upload = images.upload_packets(0xA3F9C2, data, 8, 4)
        found = packets(upload)
        first, _ = found[0]
        self.assertEqual(first, {"a": "T", "U": "1", "f": "100", "t": "d", "i": str(0xA3F9C2),
                                 "c": "8", "r": "4", "q": "2", "m": "1" if len(found) > 1 else "0"})
        self.assertEqual([keys for keys, _ in found[1:-1]],
                         [{"m": "1", "q": "2"}] * (len(found) - 2))
        self.assertEqual(found[-1][0]["m"], "0")
        self.assertTrue(all(len(payload) <= images.CHUNK for _, payload in found))
        self.assertEqual(base64.b64decode(b"".join(payload for _, payload in found)), data)

    def test_png_size_reads_the_header_and_refuses_other_files(self):
        self.assertEqual(images.png_size(png(31, 17)), (31, 17))
        for data in (b"GIF89a....", png()[:20], b""):
            with self.assertRaises(ValueError):
                images.png_size(data)


class Requests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.image = self.folder / "a.png"
        self.image.write_bytes(png())

    def request(self, **change):
        return {"action": "show", "file": "/x/a.png", "path": str(self.image), "x": 50, "y": 2,
                "w": 50, "h": 20, "hover": 1, **change}

    def test_a_valid_request(self):
        request = images.parse_request(self.request(), (30, 100))
        self.assertEqual((request.path, request.x, request.y, request.w, request.h),
                         (str(self.image), 50, 2, 50, 20))

    def test_bad_requests_are_refused(self):
        folder = self.folder / "folder"
        folder.mkdir()
        text = self.folder / "a.txt"
        text.write_text("not an image")
        big = self.folder / "big.png"
        big.write_bytes(png() + b"\0" * images.MAX_IMAGE_BYTES)
        for change in ({"path": "a.png"}, {"path": str(folder)}, {"path": str(text)},
                       {"path": str(self.folder / "gone.png")}, {"path": str(big)},
                       {"x": -1}, {"w": 0}, {"x": 51}, {"y": 11}, {"w": True}, {"h": "3"},
                       {"hover": -1}, {"file": 3}, {"path": 7}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                images.parse_request(self.request(**change), (30, 100))


class Bridge(unittest.TestCase):
    """Images: the 2 facts (the last request, what the screen shows) and 1 rule."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        patcher = mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(self.folder / "state"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.image = self.folder / "a.png"
        self.image.write_bytes(png(400, 200))
        self.screen = FakeScreen()
        self.images = self.bridge()

    def bridge(self, popup_id="a3f9c2"):
        bridge = images.Images(popup_id, self.screen)
        self.addCleanup(bridge.close)
        return bridge

    def send(self, request, bridge=None, program_shows=False):
        """Send one request on the socket, as the yazi plugin does. Return the reply.

        self.at_reply gets what the screen got before the reply came.
        """
        bridge = bridge or self.images
        reply = {}

        def client():
            with socket.socket(socket.AF_UNIX) as peer:
                peer.connect(str(images.socket_path(bridge.popup_id)))
                peer.sendall(json.dumps(request).encode() + b"\n")
                line = peer.makefile().readline()
                self.at_reply = list(self.screen.written)
                reply.update(json.loads(line))

        thread = threading.Thread(target=client)
        thread.start()
        select.select([bridge.fileno()], [], [], 5)
        bridge.serve(program_shows)
        thread.join(5)
        return reply

    def show(self, file="/x/a.png", hover=1, bridge=None, program_shows=False, **change):
        return self.send({"action": "show", "file": file, "path": str(self.image), "x": 50,
                          "y": 2, "w": 50, "h": 20, "hover": hover, **change}, bridge,
                         program_shows)

    def actions(self):
        return [keys.get("a") for keys, _ in packets(self.screen.take()) if "a" in keys]

    def test_the_socket_is_private(self):
        path = images.socket_path("a3f9c2")
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(path.lstat().st_mode), 0o600)
        self.assertTrue(stat.S_ISSOCK(path.lstat().st_mode))

    def test_a_show_replies_the_placeholder_rows_for_the_area(self):
        reply = self.show()
        self.assertEqual(reply["color"], "#a3f9c2")
        self.assertEqual(reply["rows"], images.placeholder_rows(40, 10))

    def test_the_image_shows_only_while_the_program_shows(self):
        self.show()
        self.images.sync(program_shows=False)
        self.assertEqual(self.actions(), [])
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])
        # A page shows: delete. The program shows again: draw again.
        self.images.sync(program_shows=False)
        self.assertEqual(self.actions(), ["d"])
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])

    def test_a_show_draws_the_image_before_its_reply(self):
        """The program draws the placeholder cells after the reply. A terminal
        draws cells only for an image that it has, so the image goes first."""
        self.images.sync(program_shows=True)
        self.show(program_shows=True)
        self.assertEqual([keys.get("a") for keys, _ in packets(b"".join(self.at_reply))
                          if "a" in keys], ["d", "T"])
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])

    def test_a_move_of_the_same_image_does_not_draw_it_again(self):
        """The placeholder cells carry the image to its new cells. A new upload
        would only make the terminal delete and send the same image again."""
        self.show()
        self.images.sync(program_shows=True)
        self.screen.take()
        self.show(hover=2, x=10, y=5, program_shows=True)
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])
        # Another size in cells is another placement: draw again.
        self.show(hover=3, w=20, program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])

    def test_an_erasure_on_the_screen_draws_the_image_again(self):
        self.show()
        self.images.sync(program_shows=True)
        self.screen.take()
        self.screen.show(b"\x1b[?1049h\x1b[2J")
        self.screen.take()
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])

    def test_the_image_waits_for_a_safe_point_in_the_output(self):
        self.show()
        self.screen.show(b"\x1b[38;2")
        self.screen.take()
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])
        self.screen.show(b";1;2;3m")
        self.screen.take()
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])

    def test_a_clear_for_another_file_deletes_the_image(self):
        self.show()
        self.images.sync(program_shows=True)
        self.screen.take()
        self.assertEqual(self.send({"action": "clear", "file": "/x/a.png", "hover": 2},
                                   program_shows=True), {"cleared": False})
        self.assertEqual(self.actions(), [])
        self.assertEqual(self.send({"action": "clear", "file": "/x/b.txt", "hover": 3},
                                   program_shows=True), {"cleared": True})
        # Deleted before the reply: the program draws its text preview after it.
        self.assertEqual([keys.get("a") for keys, _ in packets(b"".join(self.at_reply))
                          if "a" in keys], ["d"])
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d"])

    def test_a_show_from_before_the_last_hover_is_cancelled(self):
        self.send({"action": "clear", "file": "/x/b.txt", "hover": 5})
        self.assertEqual(self.show(hover=4), {"cancelled": True})
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])

    def test_a_clear_from_before_the_last_hover_is_ignored(self):
        # yazi runs its plugin jobs at the same time, so the clears of its
        # first hovers can come after the show of the hovered file.
        self.show(hover=6)
        self.images.sync(program_shows=True)
        self.screen.take()
        self.assertEqual(self.send({"action": "clear", "file": "/x/b.txt", "hover": 1},
                                   program_shows=True), {"cleared": False})
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])
        self.assertIsNotNone(self.images.request)

    def test_a_late_show_of_the_hovered_file_still_draws(self):
        # The hover count of a show can come before the clear of the same file.
        self.send({"action": "clear", "file": "/x/a.png", "hover": 5})
        self.assertIn("rows", self.show(hover=4))

    def test_a_bad_request_gets_an_error_and_draws_nothing(self):
        self.assertIn("error", self.show(path="relative.png"))
        self.assertIn("error", self.send({"action": "nope"}))
        self.assertIn("error", self.send(["not", "an", "object"]))
        self.images.sync(program_shows=True)
        self.assertEqual(self.actions(), [])

    def test_the_last_request_stays_for_the_next_proxy_of_the_popup(self):
        self.show()
        self.images.close()
        later = self.bridge()
        later.sync(program_shows=True)
        self.assertEqual(self.actions(), ["d", "T"])
        # A clear removes it.
        self.send({"action": "clear", "file": "/x/b.txt", "hover": 2}, later)
        later.close()
        self.screen.take()
        self.bridge().sync(program_shows=True)
        self.assertEqual(self.actions(), [])

    def test_a_socket_made_before_the_screen_takes_requests_and_the_last_request(self):
        """The toggle makes the socket before the program starts, and the proxy
        gives the screen later: the program can connect at once."""
        self.show()
        self.images.close()
        self.screen.take()
        early = images.Images("a3f9c2")
        self.addCleanup(early.close)
        with socket.socket(socket.AF_UNIX) as peer:
            peer.connect(str(images.socket_path("a3f9c2")))
            peer.sendall(json.dumps({"action": "clear", "file": "/x/a.png", "hover": 2})
                         .encode() + b"\n")
            early.attach(self.screen)
            early.sync(program_shows=True)
            self.assertEqual(self.actions(), ["d", "T"])
            early.serve()
            self.assertEqual(json.loads(peer.makefile().readline()), {"cleared": False})

    def test_a_closed_popup_leaves_no_request(self):
        import popups

        self.show()
        popups.delete_record("a3f9c2")
        self.assertFalse(images.request_path("a3f9c2").exists())

    def test_another_popup_has_its_own_socket_and_request(self):
        self.show()
        other = self.bridge("b0b0b0")
        other.sync(program_shows=True)
        self.assertEqual(self.actions(), [])
        self.assertNotEqual(images.socket_path("b0b0b0"), images.socket_path("a3f9c2"))

    def test_close_keeps_the_socket_of_a_newer_proxy(self):
        newer = self.bridge()
        self.images.close()
        self.assertTrue(images.socket_path("a3f9c2").exists())
        newer.close()
        self.assertFalse(images.socket_path("a3f9c2").exists())

    def test_without_a_cell_size_cells_are_twice_as_tall_as_wide(self):
        self.screen.cell = None
        self.assertEqual(self.show()["rows"], images.placeholder_rows(40, 10))


if __name__ == "__main__":
    unittest.main()
