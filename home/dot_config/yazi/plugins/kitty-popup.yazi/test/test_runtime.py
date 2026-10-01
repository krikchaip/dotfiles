"""Private transport, native encoder, and no-tmux delegation checks."""

import base64
import io
import json
import os
import pathlib
import collections
import random
import selectors
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zlib
from unittest.mock import Mock, patch

DIRECTORY = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DIRECTORY))
import main as RUNTIME
sys.path.pop(0)


def png(path, width=9, height=7):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = random.Random(42).randbytes(width * height * 4)
    pixels = b"".join(b"\0" + raw[y * width * 4:(y + 1) * width * 4] for y in range(height))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def gif(path):
    """Two deterministic one-pixel frames: red, then blue."""
    header = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\x00\x00\x00\x00\xff"
    loop = b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"
    frames = bytearray()
    for index in (0, 1):
        frames.extend(b"\x21\xf9\x04\x04\x07\x00\x00\x00")
        frames.extend(b"\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00")
        frames.extend(b"\x02\x02" + struct.pack("<H", 4 | (index << 3) | (5 << 6)) + b"\x00")
    path.write_bytes(header + loop + frames + b"\x3b")


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix=f"ykp-{os.getuid()}-", dir="/tmp")
        self.addCleanup(self.directory.cleanup)
        self.endpoint = pathlib.Path(self.directory.name) / "s"
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(self.server.close)
        self.server.bind(str(self.endpoint))
        self.endpoint.chmod(0o600)
        self.server.listen()

    def test_only_private_user_owned_socket_is_accepted(self):
        self.assertEqual(RUNTIME.validated_socket(str(self.endpoint)), self.endpoint)
        for location, mode in ((self.endpoint.parent, 0o755), (self.endpoint, 0o666)):
            original = location.stat().st_mode & 0o777
            location.chmod(mode)
            try:
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    RUNTIME.validated_socket(str(self.endpoint))
            finally:
                location.chmod(original)

    def test_symlink_endpoint_is_rejected(self):
        link = self.endpoint.parent / "link"
        link.symlink_to(self.endpoint)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            RUNTIME.validated_socket(str(link))

    def test_request_limit_is_checked_before_connect(self):
        with self.assertRaisesRegex(ValueError, "too large"):
            RUNTIME.rpc(str(self.endpoint), {"path": "x" * RUNTIME.MAX_REQUEST})

    def test_rpc_handles_fragmented_unicode_response(self):
        def respond():
            connection, _ = self.server.accept()
            with connection:
                body = bytearray()
                while not body.endswith(b"\n"):
                    body.extend(connection.recv(1024))
                self.assertEqual(json.loads(body), {"action": "status"})
                result = json.dumps({"rows": ["\U0010eeee\u0305"]}, ensure_ascii=False).encode() + b"\n"
                for byte in result:
                    connection.sendall(bytes([byte]))
        worker = threading.Thread(target=respond)
        worker.start()
        try:
            self.assertEqual(RUNTIME.rpc(str(self.endpoint), {"action": "status"}), {"rows": ["\U0010eeee\u0305"]})
        finally:
            worker.join(timeout=3)
        self.assertFalse(worker.is_alive())

    def test_closed_owner_is_an_explicit_error(self):
        def respond():
            connection, _ = self.server.accept()
            connection.recv(1024)
            connection.close()
        worker = threading.Thread(target=respond)
        worker.start()
        try:
            with self.assertRaisesRegex(ValueError, "disconnected"):
                RUNTIME.rpc(str(self.endpoint), {"action": "status"})
        finally:
            worker.join(timeout=3)

    def test_terminal_writer_handles_short_writes(self):
        with patch.object(RUNTIME.os, "write", side_effect=[2, 1, 3]) as write:
            RUNTIME.write_terminal(b"abcdef")
        self.assertEqual([bytes(call.args[1]) for call in write.call_args_list], [b"abcdef", b"cdef", b"def"])

    def test_no_tmux_delegates_without_creating_private_state(self):
        with patch.dict(os.environ, {"KITTY_WINDOW_ID": "99", "YAZI_KITTY_SOCKET": "stale", "YAZI_KITTY_HELPER": "stale"}, clear=True):
            with patch.object(RUNTIME.os, "execvp", side_effect=RuntimeError("exec")) as execute:
                with patch.object(RUNTIME.tempfile, "TemporaryDirectory") as state:
                    with self.assertRaisesRegex(RuntimeError, "exec"):
                        RUNTIME.run(["/a path/picture.png"])
                state.assert_not_called()
                execute.assert_called_once_with("yazi", ["yazi", "/a path/picture.png"])
                self.assertNotIn("YAZI_KITTY_SOCKET", os.environ)
                self.assertNotIn("YAZI_KITTY_HELPER", os.environ)

    def test_plain_tmux_does_not_start_popup_owner(self):
        with patch.dict(os.environ, {"KITTY_WINDOW_ID": "99", "TMUX": "/tmp/s,123,0"}, clear=True):
            with patch.object(RUNTIME.os, "execvp", side_effect=RuntimeError("exec")) as execute:
                with self.assertRaisesRegex(RuntimeError, "exec"):
                    RUNTIME.run([])
                execute.assert_called_once_with("yazi", ["yazi"])

    def test_another_pty_cannot_start_popup_owner_with_inherited_tmux_variables(self):
        env = {"KITTY_WINDOW_ID": "99", "TMUX": "/tmp/s,123,0", "TMUX_PANE": "%7", "__tmux_popup_name": "yazi_pwd"}
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(RUNTIME.os, "execvp", side_effect=RuntimeError("exec")) as execute,
            patch.object(RUNTIME.os, "isatty", return_value=True),
            patch.object(RUNTIME.os, "ttyname", return_value="/dev/another-pty"),
            patch.object(RUNTIME.os.path, "samefile", return_value=False),
            patch.object(RUNTIME, "tmux", return_value="/dev/popup-pty"),
            patch.object(RUNTIME.termios, "tcgetattr"),
            patch.object(RUNTIME.termios, "tcsetattr"),
            patch.object(RUNTIME.tempfile, "TemporaryDirectory", wraps=RUNTIME.tempfile.TemporaryDirectory) as state,
            patch.object(RUNTIME, "Owner") as owner,
        ):
            with self.assertRaisesRegex(RuntimeError, "exec"):
                RUNTIME.run([])
            state.assert_not_called()
            owner.assert_not_called()
            execute.assert_called_once_with("yazi", ["yazi"])

    def test_non_yazi_popup_does_not_start_image_owner(self):
        env = {"KITTY_WINDOW_ID": "99", "TMUX": "/tmp/s,123,0", "TMUX_PANE": "%7", "__tmux_popup_name": "floating"}
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(RUNTIME.os, "execvp", side_effect=RuntimeError("exec")) as execute,
            patch.object(RUNTIME.os, "isatty", return_value=False),
            patch.object(RUNTIME, "Owner") as owner,
        ):
            with self.assertRaisesRegex(RuntimeError, "exec"):
                RUNTIME.run([])
            owner.assert_not_called()
            execute.assert_called_once_with("yazi", ["yazi"])

    def test_nested_frontend_cannot_change_the_popup_image_state(self):
        owner = RUNTIME.Owner.__new__(RUNTIME.Owner)
        owner.frontend = Mock(pid=123)
        owner.reply = Mock()
        owner.cancel_encoder = Mock()
        owner.session = Mock()
        peer = Mock()
        owner.prepare(peer, {"pid": 456})
        owner.reply.assert_called_once_with(peer, {"fallback": True})
        owner.cancel_encoder.assert_not_called()
        owner.session.begin.assert_not_called()

    def test_closed_owner_prepare_cli_delegates_instead_of_replacing_native_preview(self):
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"YAZI_KITTY_SOCKET": "/exited-owner"}),
            patch.object(sys, "argv", ["main.py", "prepare", "1", "/unused.png", "5", "7", "40", "20"]),
            patch.object(RUNTIME, "rpc", side_effect=OSError("owner exited")),
            patch.object(sys, "stdout", output),
        ):
            self.assertEqual(RUNTIME.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"fallback": True})

    def test_clear_if_left_erases_only_captured_placeholder_cells_and_discards_image(self):
        owner = RUNTIME.Owner.__new__(RUNTIME.Owner)
        owner.current_preview = ("/old.png", 5, 0, (3,))
        owner.pane = "%7"
        owner.session = Mock()
        with (
            patch.object(RUNTIME, "tmux", return_value="left│" + RUNTIME.PLACEHOLDER + "\u0305Text" + RUNTIME.PLACEHOLDER),
            patch.object(RUNTIME, "write_terminal") as write,
        ):
            self.assertTrue(owner.clear_if_left("/text.txt"))
        owner.session.discard.assert_called_once_with()
        write.assert_called_once_with(b"\x1b7\x1b[1;6H \x1b8")
        self.assertIsNone(owner.current_preview)

    def test_clear_if_left_keeps_the_current_image(self):
        owner = RUNTIME.Owner.__new__(RUNTIME.Owner)
        owner.current_preview = ("/same.png", 5, 0, (3,))
        owner.session = Mock()
        self.assertFalse(owner.clear_if_left("/same.png"))
        owner.session.discard.assert_not_called()

    def test_metrics_use_original_caller_not_inner_estimate(self):
        with patch.dict(os.environ, {"TMUX": "/tmp/inner,234,0", "TMUX_PANE": "%7"}, clear=True):
            with patch.object(RUNTIME, "tmux", side_effect=["%2:/tmp/outer,123,0", "18 35"]) as tmux:
                self.assertEqual(RUNTIME.physical_cells(), (18, 35))
                self.assertEqual(tmux.call_args.kwargs["env"]["TMUX"], "/tmp/outer,123,0")
                self.assertNotIn("TMUX_PANE", tmux.call_args.kwargs["env"])

    def test_zero_caller_pixel_metrics_are_not_guessed(self):
        with patch.dict(os.environ, {"TMUX_PANE": "%7"}):
            with patch.object(RUNTIME, "tmux", side_effect=["%2:/tmp/outer,123,0", "0 0"]):
                with self.assertRaisesRegex(ValueError, "pixel cell"):
                    RUNTIME.physical_cells()

    def test_cancellation_reaps_real_decoder_and_invalidates_token(self):
        owner = RUNTIME.Owner.__new__(RUNTIME.Owner)
        owner.selector = selectors.DefaultSelector()
        self.addCleanup(owner.selector.close)
        owner.peers = {}
        owner.events = collections.deque(maxlen=1)
        owner.session = RUNTIME.ImageSession(2, Mock(), new_id=lambda: 123)
        owner.session.begin(1)
        owner.read_wake, owner.write_wake = os.pipe()
        self.addCleanup(os.close, owner.read_wake)
        self.addCleanup(os.close, owner.write_wake)
        left, right = socket.socketpair()
        self.addCleanup(left.close)
        self.addCleanup(right.close)
        process = subprocess.Popen([sys.executable, "-c", "import os; os.read(0,1)"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        self.addCleanup(process.stdin.close)
        encoder = RUNTIME.Encoder(1, 123, RUNTIME.Peer(left), process, "/unused.png", (5, 7))
        owner.encoder = encoder
        encoder.thread = threading.Thread(target=owner.encode, args=(encoder,))
        encoder.thread.start()
        owner.cancel_encoder()
        self.assertIsNotNone(process.poll())
        self.assertFalse(encoder.thread.is_alive())
        self.assertIsNone(owner.encoder)
        self.assertIsNone(owner.session.pending_id)
        self.assertEqual(json.loads(right.recv(1024)), {"cancelled": True})
        self.assertFalse(owner.session.commit("old"))
        self.assertEqual(len(owner.events), 0)


class NativeEncoderTests(unittest.TestCase):
    def test_real_animated_gif_keeps_only_first_frame(self):
        with tempfile.TemporaryDirectory(prefix="ykp-gif-test-") as directory:
            path = pathlib.Path(directory) / "animated.gif"
            gif(path)
            result = subprocess.run([
                "kitten", "icat", "--unicode-placeholder", "--transfer-mode", "stream",
                "--passthrough", "none", "--stdin", "no", "--align", "left", "--loop", "0",
                "--place", "40x20@0x0", "--use-window-size", "40,20,720,700",
                "--image-id", "81234325", "--", str(path),
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True)
            self.assertIn(b"\x1b_Ga=a", result.stdout)
            preview = RUNTIME.parse_icat(result.stdout, 81234325)
            self.assertTrue(preview.rows)
            self.assertNotIn(b"\x1b_Ga=a", b"".join(preview.packets))
            self.assertNotIn(b"\x1b_Ga=f", b"".join(preview.packets))
            header = dict(field.split(b"=", 1) for field in preview.packets[0][3:-2].split(b";", 1)[0].split(b","))
            payload = b"".join(packet[3:-2].split(b";", 1)[1] for packet in preview.packets)
            pixels = base64.b64decode(payload + b"=" * (-len(payload) % 4))
            if header.get(b"o") == b"z":
                pixels = zlib.decompress(pixels)
            pixel_format = header.get(b"f", b"32")
            self.assertIn(pixel_format, (b"24", b"32"))
            self.assertEqual(pixels, b"\xff\x00\x00" + (b"\xff" if pixel_format == b"32" else b""))  # Red, not blue.
            session = RUNTIME.ImageSession(2, Mock(), new_id=lambda: 81234325)
            session.begin(1)
            self.assertTrue(session.commit(session.prepare(1, preview)))

    def test_real_icat_output_passes_parser_and_chunker(self):
        for width, height in ((9, 7), (600, 300)):
            with self.subTest(size=(width, height)):
                self.assert_native_image(width, height)

    def assert_native_image(self, width, height):
        with tempfile.TemporaryDirectory(prefix="ykp-native-test-") as directory:
            path = pathlib.Path(directory) / "a picture; $(not a command).png"
            png(path, width, height)
            result = subprocess.run([
                "kitten", "icat", "--unicode-placeholder", "--transfer-mode", "stream",
                "--passthrough", "none", "--stdin", "no", "--align", "left", "--loop", "0",
                "--place", "40x20@0x0", "--use-window-size", "40,20,720,700",
                "--image-id", "81234325", "--", str(path),
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True)
            preview = RUNTIME.parse_icat(result.stdout, 81234325)
            self.assertTrue(preview.rows)
            if width > 9:
                self.assertGreater(len(preview.packets), 1)
            self.assertTrue(all(row.startswith(chr(0x10eeee)) for row in preview.rows))
            writes = []
            owner = RUNTIME.ImageSession(2, writes.append, new_id=lambda: 81234325)
            owner.begin(1)
            self.assertTrue(owner.commit(owner.prepare(1, preview)))
            self.assertEqual(len(writes), 1)
            owner.close()
            self.assertIn(b"i=81234325", writes[-1])


if __name__ == "__main__":
    unittest.main()
