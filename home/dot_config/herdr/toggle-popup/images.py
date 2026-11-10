"""Yazi image previews in a popup.

Herdr 0.9.5 sends no images to `terminal attach` clients (herdrdev/herdr#5408),
so the viewer shows a popup's program without its images. The yazi plugin
kitty-popup.yazi fills the gap: in a popup, its previewer sends the image file
and the preview area to the proxy on a private socket. The proxy draws the
image in the popup terminal, and yazi draws the image's Unicode placeholder
cells (kitty graphics protocol). The popup server runs without kitty graphics
(toggle_popup.popup_session_config()), so these cells reach the viewer as
text. Herdr places the image where the cells show, so text over the cells,
such as a yazi dialog or a program that yazi starts, hides the image.

The proxy keeps 2 facts: the last request of the program, and what the
screen shows (the program or a proxy page). One rule follows from them: when
the program shows and a request is there, the image is in the terminal;
otherwise it is not. Images.sync() applies the rule after each change. A
screen clear or a screen switch in the output, such as the proxy's pages and
each new viewer, erases the image: Output counts these erasures, and sync()
draws the image again.

The image data goes inline (t=d), so it also works when the popup shows on a
remote Herdr client. Remove this file when Herdr shows images to attach clients.

The socket protocol: one JSON request line, one JSON reply line.
  {"action": "show", "file": F, "path": P, "x": X, "y": Y, "w": W, "h": H, "hover": N}
      F is the hovered file, P a PNG of it, and X, Y, W, H the preview area in
      cells. N counts yazi's hover changes: a show from an older hover gets
      {"cancelled": true}. Else the reply is {"rows": [...], "color": "#rrggbb"}:
      the placeholder rows that yazi draws, in that foreground color.
  {"action": "clear", "file": F, "hover": N}
      The cursor moved to F. The request of another file ends: {"cleared": true}.
  An error gets {"error": TEXT}.
"""

import base64
import contextlib
import json
import math
import os
import re
import socket
import stat
import struct
import typing
import zlib

from herdr_api import plugin_state_path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# A larger image is too slow to send each time the program shows. The yazi
# plugin makes a smaller PNG of a large image.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REQUEST = 64 * 1024
# The kitty graphics protocol sends at most 4096 bytes of base64 per command.
CHUNK = 4096
# A request must arrive this soon after its connection.
REQUEST_SECONDS = 0.5
# The longest Unix socket path that works on macOS and Linux.
MAX_SOCKET_PATH = 100
# Cell pixels when the terminal does not give them: a usual cell shape.
DEFAULT_CELL = (10, 20)
PLACEHOLDER = "\U0010EEEE"
# Kitty's row and column diacritics: the Nth mark names row or column N
# (https://sw.kovidgoyal.net/kitty/_downloads/f0a0de9ec8d9ff4456206db8e0814937/rowcolumn-diacritics.txt).
DIACRITICS = "".join(map(chr, (
    0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A, 0x034B,
    0x034C, 0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367,
    0x0368, 0x0369, 0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F, 0x0483, 0x0484, 0x0485,
    0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059C, 0x059D,
    0x059E, 0x059F, 0x05A0, 0x05A1, 0x05A8, 0x05A9, 0x05AB, 0x05AC, 0x05AF, 0x05C4, 0x0610,
    0x0611, 0x0612, 0x0613, 0x0614, 0x0615, 0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065A,
    0x065B, 0x065D, 0x065E, 0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF,
    0x06E0, 0x06E1, 0x06E2, 0x06E4, 0x06E7, 0x06E8, 0x06EB, 0x06EC, 0x0730, 0x0732, 0x0733,
    0x0735, 0x0736, 0x073A, 0x073D, 0x073F, 0x0740, 0x0741, 0x0743, 0x0745, 0x0747, 0x0749,
    0x074A, 0x07EB, 0x07EC, 0x07ED, 0x07EE, 0x07EF, 0x07F0, 0x07F1, 0x07F3, 0x0816, 0x0817,
    0x0818, 0x0819, 0x081B, 0x081C, 0x081D, 0x081E, 0x081F, 0x0820, 0x0821, 0x0822, 0x0823,
    0x0825, 0x0826, 0x0827, 0x0829, 0x082A, 0x082B, 0x082C, 0x082D, 0x0951, 0x0953, 0x0954,
    0x0F82, 0x0F83, 0x0F86, 0x0F87, 0x135D, 0x135E, 0x135F, 0x17DD, 0x193A, 0x1A17, 0x1A75,
    0x1A76, 0x1A77, 0x1A78, 0x1A79, 0x1A7A, 0x1A7B, 0x1A7C, 0x1B6B, 0x1B6D, 0x1B6E, 0x1B6F,
    0x1B70, 0x1B71, 0x1B72, 0x1B73, 0x1CD0, 0x1CD1, 0x1CD2, 0x1CDA, 0x1CDB, 0x1CE0, 0x1DC0,
    0x1DC1, 0x1DC3, 0x1DC4, 0x1DC5, 0x1DC6, 0x1DC7, 0x1DC8, 0x1DC9, 0x1DCB, 0x1DCC, 0x1DD1,
    0x1DD2, 0x1DD3, 0x1DD4, 0x1DD5, 0x1DD6, 0x1DD7, 0x1DD8, 0x1DD9, 0x1DDA, 0x1DDB, 0x1DDC,
    0x1DDD, 0x1DDE, 0x1DDF, 0x1DE0, 0x1DE1, 0x1DE2, 0x1DE3, 0x1DE4, 0x1DE5, 0x1DE6, 0x1DFE,
    0x20D0, 0x20D1, 0x20D4, 0x20D5, 0x20D6, 0x20D7, 0x20DB, 0x20DC, 0x20E1, 0x20E7, 0x20E9,
    0x20F0, 0x2CEF, 0x2CF0, 0x2CF1, 0x2DE0, 0x2DE1, 0x2DE2, 0x2DE3, 0x2DE4, 0x2DE5, 0x2DE6,
    0x2DE7, 0x2DE8, 0x2DE9, 0x2DEA, 0x2DEB, 0x2DEC, 0x2DED, 0x2DEE, 0x2DEF, 0x2DF0, 0x2DF1,
    0x2DF2, 0x2DF3, 0x2DF4, 0x2DF5, 0x2DF6, 0x2DF7, 0x2DF8, 0x2DF9, 0x2DFA, 0x2DFB, 0x2DFC,
    0x2DFD, 0x2DFE, 0x2DFF, 0xA66F, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA8E0, 0xA8E1, 0xA8E2,
    0xA8E3, 0xA8E4, 0xA8E5, 0xA8E6, 0xA8E7, 0xA8E8, 0xA8E9, 0xA8EA, 0xA8EB, 0xA8EC, 0xA8ED,
    0xA8EE, 0xA8EF, 0xA8F0, 0xA8F1, 0xAAB0, 0xAAB2, 0xAAB3, 0xAAB7, 0xAAB8, 0xAABE, 0xAABF,
    0xAAC1, 0xFE20, 0xFE21, 0xFE22, 0xFE23, 0xFE24, 0xFE25, 0xFE26, 0x10A0F, 0x10A38, 0x1D185,
    0x1D186, 0x1D187, 0x1D188, 0x1D189, 0x1D1AA, 0x1D1AB, 0x1D1AC, 0x1D1AD, 0x1D242, 0x1D243,
    0x1D244,
)))
# Screen clears and screen switches: the terminal deletes the images that show.
ERASURE = re.compile(rb"\x1b\[[23]J|\x1b\[\?(?:1049|1047|47)[hl]|\x1bc")
CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
ESCAPE = re.compile(rb"\x1b[ -/]*[0-~]")
# Escape sequences that hold text up to BEL or ST (ESC \\): OSC, DCS, APC, PM, SOS.
STRINGS = b"]P_^X"


class Output:
    """The bytes that go to the popup terminal, as far as images care.

    `safe` is True when the output ends between escape sequences and
    characters, so an image command can go in. `erasures` counts the screen
    clears and screen switches.
    """

    def __init__(self):
        self.erasures = 0
        # The end of the output that is not complete yet.
        self.tail = b""

    @property
    def safe(self):
        return not self.tail

    def feed(self, data):
        text = self.tail + data
        self.erasures += len(ERASURE.findall(text))
        self.tail = b""
        start = text.rfind(b"\x1b")
        if start >= 0 and not complete(text[start:]):
            self.tail = text[start:]
            # A complete erasure in the tail counted already.
            self.erasures -= len(ERASURE.findall(self.tail))
            return
        self.tail = utf8_tail(text)


def complete(sequence):
    """True when `sequence`, from its ESC on, is a complete escape sequence."""
    if len(sequence) < 2:
        return False
    kind = sequence[1:2]
    if kind == b"[":
        return CSI.match(sequence) is not None
    if kind in (bytes([byte]) for byte in STRINGS):
        # The ESC of an ST is the last ESC, so only BEL ends the string here.
        return b"\x07" in sequence
    return ESCAPE.match(sequence) is not None


def utf8_tail(text):
    """The bytes at the end of `text` that start a UTF-8 character, but do not end it."""
    for back in range(1, min(4, len(text)) + 1):
        byte = text[-back]
        if byte < 0x80:
            return b""
        if byte >= 0xC0:
            length = 2 if byte < 0xE0 else 3 if byte < 0xF0 else 4
            return text[-back:] if length > back else b""
    return b""


def socket_path(popup_id):
    """The socket of a popup's images. launch.py gives it to the popup's program."""
    return plugin_state_path() / "images" / f"{popup_id}.sock"


def request_path(popup_id):
    """The last request of a popup's program, for the next proxy that shows the popup."""
    return plugin_state_path() / "images" / f"{popup_id}.json"


def image_id(popup_id):
    """The image id of a popup: its 24-bit popup id, so one color names it."""
    try:
        value = int(popup_id, 16)
    except ValueError:
        value = zlib.crc32(popup_id.encode())
    return value & 0xFFFFFF or 1


def color(image):
    return f"#{image:06x}"


def png_size(data):
    """The (width, height) of a PNG. Raise ValueError for other data."""
    if not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR" or len(data) < 24:
        raise ValueError("the image is not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height:
        raise ValueError("the PNG has no pixels")
    return width, height


def placement(pixels, area, cell):
    """The (columns, rows) that show an image of `pixels` in `area` cells.

    The image keeps its shape, and a small image is not made larger.
    """
    (width, height), (columns, rows), (cell_width, cell_height) = pixels, area, cell
    scale = min(1.0, columns * cell_width / width, rows * cell_height / height)
    return (max(1, min(columns, math.ceil(width * scale / cell_width))),
            max(1, min(rows, math.ceil(height * scale / cell_height))))


def placeholder_rows(columns, rows):
    """The placeholder text of an image: each cell names its row and its column."""
    return ["".join(PLACEHOLDER + DIACRITICS[row] + DIACRITICS[column]
                    for column in range(columns)) for row in range(rows)]


def upload_packets(image, data, columns, rows):
    """Kitty graphics commands that send a PNG for placeholders of columns x rows."""
    payload = base64.b64encode(data)
    chunks = [payload[start:start + CHUNK] for start in range(0, len(payload), CHUNK)]
    out = []
    for number, chunk in enumerate(chunks):
        more = "1" if number < len(chunks) - 1 else "0"
        control = (f"a=T,U=1,f=100,t=d,i={image},c={columns},r={rows},q=2,m={more}"
                   if number == 0 else f"m={more},q=2")
        out.append(b"\x1b_G" + control.encode() + b";" + chunk + b"\x1b\\")
    return b"".join(out)


def delete_packet(image):
    """A kitty graphics command that deletes an image and its data."""
    return f"\x1b_Ga=d,d=I,i={image},q=2\x1b\\".encode()


class Request(typing.NamedTuple):
    """A show request of the program. `data` is the PNG and `pixels` its size."""

    file: str
    path: str
    x: int
    y: int
    w: int
    h: int
    hover: int
    data: bytes
    pixels: tuple

    def saved(self):
        return {"file": self.file, "path": self.path, "x": self.x, "y": self.y, "w": self.w,
                "h": self.h, "hover": self.hover}


def number(value, least):
    if isinstance(value, bool) or not isinstance(value, int) or value < least:
        raise ValueError("the preview area is not valid")
    return value


def parse_request(request, size):
    """Check a show request for a screen of `size` (rows, columns). Return a Request.

    Raise ValueError for a request that is not valid.
    """
    file, path = request.get("file"), request.get("path")
    if not isinstance(file, str) or not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("the image must be an absolute path")
    x, y = number(request.get("x"), 0), number(request.get("y"), 0)
    w, h = number(request.get("w"), 1), number(request.get("h"), 1)
    hover = number(request.get("hover"), 0)
    rows, columns = size
    if x + w > columns or y + h > rows or w > len(DIACRITICS) or h > len(DIACRITICS):
        raise ValueError("the preview area is not on the screen")
    try:
        with open(path, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("the image is not a file")
            if info.st_size > MAX_IMAGE_BYTES:
                raise ValueError("the image is too large")
            data = stream.read(MAX_IMAGE_BYTES + 1)
    except IsADirectoryError:
        raise ValueError("the image is not a file") from None
    except OSError as error:
        raise ValueError(f"cannot read the image: {error.strerror}") from None
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("the image is too large")
    return Request(file, path, x, y, w, h, hover, data, png_size(data))


class Images:
    """The image previews of one popup's program.

    `screen` is the popup terminal: show(data), size() as (rows, columns),
    cell_size() as (width, height) pixels or None, and `output`, an Output of
    all that it shows. The socket listens from the start: the toggle makes
    it before the program starts, and the proxy gives the screen later with
    attach(). Requests wait on the socket until serve().
    """

    def __init__(self, popup_id, screen=None):
        self.popup_id = popup_id
        self.image = image_id(popup_id)
        # Fact 1: the last request of the program, and the commands that draw it.
        self.request = None
        self.upload = None
        # The newest hover that the program reported, and its file.
        self.hover = 0
        self.hovered = None
        # What is in the terminal: (upload, erasure count) of the drawn image, or None.
        # A request for other cells with the same upload needs no new upload: the
        # placeholder cells carry the image.
        self.drawn = None
        self.server = None
        self.screen = None
        self.listen()
        if screen is not None:
            self.attach(screen)

    def attach(self, screen):
        """Draw on `screen`, from the last request of an earlier proxy, if any."""
        self.screen = screen
        self.load()

    # The socket

    def listen(self):
        path = socket_path(self.popup_id)
        if len(os.fsencode(path)) > MAX_SOCKET_PATH:
            return
        try:
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.parent.chmod(0o700)
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
            server = socket.socket(socket.AF_UNIX)
            try:
                server.bind(str(path))
                path.chmod(0o600)
                server.listen(4)
                server.setblocking(False)
            except OSError:
                server.close()
                raise
        except OSError:
            # Without the socket, the program shows no images.
            return
        self.server = server
        self.inode = path.lstat().st_ino

    def fileno(self):
        return self.server.fileno() if self.server is not None else None

    def close(self):
        if self.server is None:
            return
        path = socket_path(self.popup_id)
        try:
            # A newer proxy of the same popup can own the path now.
            if path.lstat().st_ino == self.inode:
                path.unlink()
        except OSError:
            pass
        self.server.close()
        self.server = None

    def serve(self, program_shows=False):
        """Answer one request that waits on the socket.

        The rule runs before the reply: the program draws the placeholder
        cells after it, and a terminal draws them only for an image it has.
        """
        try:
            peer, _ = self.server.accept()
        except (BlockingIOError, InterruptedError):
            return
        with peer:
            try:
                peer.setblocking(True)
                peer.settimeout(REQUEST_SECONDS)
                line = read_line(peer)
            except OSError:
                return
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError("the request is not an object")
                reply = self.handle(request)
            except ValueError as error:
                reply = {"error": str(error)}
            self.sync(program_shows)
            try:
                peer.sendall(json.dumps(reply).encode() + b"\n")
            except OSError:
                pass

    def handle(self, request):
        action = request.get("action")
        if action == "show":
            new = parse_request(request, self.screen.size())
            if new.hover < self.hover and new.file != self.hovered:
                return {"cancelled": True}
            self.hover, self.hovered = max(self.hover, new.hover), new.file
            columns, rows = self.set_request(new)
            self.save()
            return {"rows": placeholder_rows(columns, rows), "color": color(self.image)}
        if action == "clear":
            file, hover = request.get("file"), number(request.get("hover"), 0)
            if not isinstance(file, str):
                raise ValueError("the file must be a path")
            # yazi runs its plugin jobs at the same time: the clear of an
            # earlier hover can come after a newer show. It ends nothing.
            if hover < self.hover:
                return {"cleared": False}
            self.hover, self.hovered = hover, file
            if self.request is None or self.request.file == file:
                return {"cleared": False}
            self.request = self.upload = None
            self.save()
            return {"cleared": True}
        raise ValueError("unknown action")

    def set_request(self, request, grid=None):
        """Make `request` the last request. Return its (columns, rows)."""
        cell = self.screen.cell_size() or DEFAULT_CELL
        columns, rows = grid or placement(request.pixels, (request.w, request.h), cell)
        self.request = request
        self.grid = (columns, rows)
        self.upload = delete_packet(self.image) + upload_packets(self.image, request.data,
                                                                 columns, rows)
        return columns, rows

    # The last request, for the next proxy of the popup

    def save(self):
        path = request_path(self.popup_id)
        try:
            if self.request is None:
                path.unlink(missing_ok=True)
                return
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump({**self.request.saved(), "grid": list(self.grid)}, stream)
            os.replace(temporary, path)
        except OSError:
            pass

    def load(self):
        """Take the last request of the popup's program from an earlier proxy."""
        try:
            saved = json.loads(request_path(self.popup_id).read_text(encoding="utf-8"))
            request = parse_request(saved, self.screen.size())
            columns, rows = saved["grid"]
            grid = (number(columns, 1), number(rows, 1))
        except (OSError, ValueError, KeyError, TypeError):
            return
        self.hover, self.hovered = request.hover, request.file
        self.set_request(request, grid)

    # The rule

    def sync(self, program_shows):
        """Make the terminal match the rule: the image shows when the program
        shows and a request is there."""
        output = self.screen.output
        if not output.safe:
            return
        if program_shows and self.request is not None:
            if self.drawn != (self.upload, output.erasures):
                self.screen.show(self.upload)
                self.drawn = (self.upload, output.erasures)
        elif self.drawn is not None:
            self.screen.show(delete_packet(self.image))
            self.drawn = None


def read_line(peer):
    data = b""
    while b"\n" not in data:
        chunk = peer.recv(65536)
        if not chunk:
            break
        data += chunk
        if len(data) > MAX_REQUEST:
            raise ValueError("the request is too large")
    return data.split(b"\n", 1)[0]
