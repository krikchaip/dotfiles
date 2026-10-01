#!/usr/bin/env python3
"""Kitty image transport for Yazi's persistent tmux popup.

Only image packets are forwarded. Placeholder rows belong to Yazi's widget grid;
this module does not replay terminal output or answer terminal queries.
"""

from __future__ import annotations

import base64
import binascii
import re
import secrets
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass

ESC = b"\x1b"
APC_START = ESC + b"_G"
ST = ESC + b"\\"
PLACEHOLDER = chr(0x10EEEE)
APC = re.compile(rb"\x1b_G.*?\x1b\\", re.DOTALL)
CSI = re.compile(rb"\x1b\[([0-?]*)([ -/]*)([@-~])")
FIELD = re.compile(rb"([A-Za-z])=([A-Za-z0-9_.+-]+)\Z")


@dataclass(frozen=True)
class Preview:
    rows: tuple[str, ...]
    packets: tuple[bytes, ...]
    color: str


def clear_placeholder_cells(screen: str, x: int, y: int, row_widths: tuple[int, ...]) -> bytes:
    """Erase only placeholder cells that still occupy the previous image area."""
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (x, y, *row_widths)):
        raise ValueError("invalid placeholder area")
    lines = screen.splitlines()
    commands = []
    for row, width in enumerate(row_widths):
        line_index = y + row
        if width == 0 or line_index >= len(lines):
            continue
        column = 0
        placeholders = set()
        for char in lines[line_index]:
            if unicodedata.category(char).startswith("M"):
                continue
            if char == PLACEHOLDER:
                placeholders.add(column)
            if char == "\t":
                column += 8 - column % 8
            else:
                column += 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
        columns = sorted(placeholders.intersection(range(x, x + width)))
        start = previous = None
        for column in columns + [None]:
            if start is None:
                start = previous = column
            elif column is not None and column == previous + 1:
                previous = column
            else:
                commands.append(f"\x1b[{line_index + 1};{start + 1}H".encode() + b" " * (previous - start + 1))
                start = previous = column
    return b"" if not commands else b"\x1b7" + b"".join(commands) + b"\x1b8"


def tmux_wrap(data: bytes, layers: int) -> bytes:
    if isinstance(layers, bool) or not isinstance(layers, int) or not 0 <= layers <= 8:
        raise ValueError("tmux layer count must be an integer from 0 to 8")
    for _ in range(layers):
        data = ESC + b"Ptmux;" + data.replace(ESC, ESC + ESC) + ST
    return data


def _packet_parts(packet: bytes) -> tuple[list[tuple[bytes, bytes]], bytes]:
    if not packet.startswith(APC_START) or not packet.endswith(ST):
        raise ValueError("invalid Kitty graphics packet framing")
    content = packet[len(APC_START) : -len(ST)]
    header, separator, body = content.partition(b";")
    fields = []
    seen = set()
    for field in header.split(b","):
        match = FIELD.fullmatch(field)
        if not match or match[1] in seen:
            raise ValueError("invalid or duplicate Kitty graphics field")
        seen.add(match[1])
        fields.append((match[1], match[2]))
    # Control commands, such as animation state, can have no payload separator.
    if not separator and dict(fields).get(b"a") in (None, b"T", b"t"):
        raise ValueError("Kitty graphics packet has no payload separator")
    if dict(fields).get(b"m", b"0") not in (b"0", b"1"):
        raise ValueError("invalid Kitty multipart flag")
    try:
        # icat omits trailing padding. Validate without changing its wire bytes.
        base64.b64decode(body + b"=" * (-len(body) % 4), validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("invalid Kitty base64 payload") from error
    return fields, body


def split_graphics_packet(packet: bytes, max_payload: int = 4096) -> list[bytes]:
    if isinstance(max_payload, bool) or not isinstance(max_payload, int) or max_payload < 4:
        raise ValueError("payload limit must allow at least one base64 quartet")
    fields, body = _packet_parts(packet)
    if len(body) <= max_payload:
        return [packet]
    size = max_payload - max_payload % 4
    original = dict(fields)
    final_m = original.get(b"m", b"0")
    base_fields = [(key, value) for key, value in fields if key != b"m"]
    packets = []
    for offset in range(0, len(body), size):
        final = offset + size >= len(body)
        m = final_m if final else b"1"
        chunk_fields = list(base_fields) if offset == 0 else []
        if offset != 0 and b"q" in original:
            chunk_fields.append((b"q", original[b"q"]))
        chunk_fields.append((b"m", m))
        header = b",".join(key + b"=" + value for key, value in chunk_fields)
        packets.append(APC_START + header + b";" + body[offset : offset + size] + ST)
    return packets


def _placeholder_rows(text: bytes) -> tuple[str, ...]:
    output = bytearray()
    offset = 0
    while offset < len(text):
        byte = text[offset]
        if byte == 0x1B:
            if text[offset : offset + 2] in (ESC + b"7", ESC + b"8"):
                offset += 2
                continue
            match = CSI.match(text, offset)
            if not match or match[2]:
                raise ValueError("unexpected terminal control in image placeholders")
            params, action = match[1], match[3]
            cursor = action in (b"H", b"f", b"C") and re.fullmatch(rb"[0-9;]*", params)
            color = action == b"m" and re.fullmatch(rb"[0-9;:]*", params)
            if not cursor and not color:
                raise ValueError("unexpected CSI control in image placeholders")
            if color:
                numbers = [int(n) for n in re.split(rb"[;:]", params) if n]
                if numbers not in ([], [0], [39]) and not (
                    len(numbers) == 5 and numbers[:2] == [38, 2]
                    and all(0 <= n <= 255 for n in numbers[2:])
                ):
                    raise ValueError("unexpected image color control")
            offset = match.end()
        elif byte == 0x0D:
            offset += 1
        elif byte < 0x20 and byte != 0x0A:
            raise ValueError("unexpected control byte in image placeholders")
        else:
            output.append(byte)
            offset += 1
    rows = bytes(output).decode("utf-8").splitlines()
    if not rows or any(not row for row in rows):
        raise ValueError("image has no complete placeholder rows")
    for row in rows:
        saw_placeholder = False
        for char in row:
            if char == PLACEHOLDER:
                saw_placeholder = True
            elif not saw_placeholder or not unicodedata.category(char).startswith("M"):
                raise ValueError("unexpected text in image placeholders")
    return tuple(rows)


def parse_icat(data: bytes, image_id: int) -> Preview:
    if isinstance(image_id, bool) or not isinstance(image_id, int) or not 1 <= image_id <= 0xFFFFFFFF:
        raise ValueError("image ID must be a nonzero unsigned 32-bit integer")
    matches = list(APC.finditer(data))
    if not matches:
        raise ValueError("icat emitted no Kitty image packets")
    packets = []
    complete = False
    discarding_frame = False
    initial_action = None
    expected_id = str(image_id).encode()
    for index, match in enumerate(matches):
        packet = match[0]
        fields, body = _packet_parts(packet)
        values = dict(fields)
        if complete:
            # --loop=0 still uploads animation frames and controls. Keep only
            # the first frame. Never forward discarded commands to Kitty.
            if values.get(b"q", b"2") != b"2" or values.get(b"t", b"d") != b"d" or values.get(b"i", expected_id) != expected_id:
                raise ValueError("unexpected animation image ID, transfer, or reply policy")
            action = values.get(b"a")
            if discarding_frame:
                if set(values) - {b"a", b"m", b"q", b"i"} or action not in (None, b"f"):
                    raise ValueError("unexpected animation continuation packet")
                discarding_frame = values.get(b"m", b"0") == b"1"
            elif values.get(b"i") == expected_id and action == b"f":
                discarding_frame = values.get(b"m", b"0") == b"1"
            elif values.get(b"i") == expected_id and action == b"a" and not body and values.get(b"m", b"0") == b"0":
                pass
            else:
                raise ValueError("unexpected image continuation packet")
            continue
        if index == 0:
            initial_action = values.get(b"a")
            if values.get(b"a") not in (b"T", b"t") or values.get(b"U") != b"1":
                raise ValueError("icat did not emit a Unicode-placeholder image")
            if values.get(b"i") != expected_id or values.get(b"q") != b"2":
                raise ValueError("icat emitted an unexpected image ID or reply policy")
            if values.get(b"t", b"d") != b"d":
                raise ValueError("icat must use stream transfer")
        elif set(values) - {b"a", b"m", b"q", b"i"}:
            raise ValueError("unexpected image continuation packet")
        elif b"a" in values and values[b"a"] != initial_action:
            raise ValueError("unexpected continuation action")
        elif values.get(b"q", b"2") != b"2":
            raise ValueError("unexpected continuation reply policy")
        elif b"i" in values and values[b"i"] != expected_id:
            raise ValueError("unexpected continuation image ID")
        packets.append(packet)
        complete = values.get(b"m", b"0") == b"0"
    if not complete or discarding_frame:
        raise ValueError("incomplete Kitty image transfer")
    rows = _placeholder_rows(APC.sub(b"", data))
    return Preview(rows=rows, packets=tuple(packets), color=f"#{image_id & 0xFFFFFF:06x}")


def delete_packet(image_id: int) -> bytes:
    return APC_START + f"a=d,d=I,i={image_id},q=2;".encode() + ST


class ImageSession:
    """One live app's bounded image state; no screen replay or global deletes."""

    def __init__(
        self,
        layers: int,
        emit: Callable[[bytes], None],
        new_id: Callable[[], int] | None = None,
    ) -> None:
        tmux_wrap(b"", layers)
        self.layers = layers
        self.emit = emit
        self.new_id = new_id or (lambda: secrets.randbelow(0xFFFFFFFF) + 1)
        self.serial = 0
        self.pending_id: int | None = None
        self.ready: tuple[str, int, bytes] | None = None
        self.current: tuple[int, bytes] | None = None
        self.owned: set[int] = set()
        self.closed = False

    def begin(self, serial: int) -> int | None:
        if isinstance(serial, bool) or not isinstance(serial, int) or serial < 1:
            raise ValueError("preview serial must be a positive integer")
        if self.closed:
            raise ValueError("image session is closed")
        if serial <= self.serial:
            return None
        for _ in range(32):
            image_id = self.new_id()
            if isinstance(image_id, bool) or not isinstance(image_id, int) or not 1 <= image_id <= 0xFFFFFFFF:
                raise ValueError("invalid allocated image ID")
            if image_id not in self.owned:
                break
        else:
            raise ValueError("could not allocate an unused image ID")
        self.serial = serial
        self.pending_id = image_id
        self.ready = None
        return image_id

    def prepare(self, serial: int, preview: Preview) -> str | None:
        if self.closed or serial != self.serial or self.pending_id is None:
            return None
        if not isinstance(preview, Preview) or preview.color != f"#{self.pending_id & 0xFFFFFF:06x}":
            raise ValueError("preview does not belong to this image session")
        validated = parse_icat(
            b"".join(preview.packets) + "\n".join(preview.rows).encode(), self.pending_id
        )
        if validated != preview:
            raise ValueError("invalid prepared image")
        wire = b"".join(
            tmux_wrap(chunk, self.layers)
            for packet in preview.packets
            for chunk in split_graphics_packet(packet)
        )
        token = secrets.token_hex(16)
        self.ready = (token, self.pending_id, wire)
        return token

    def commit(self, token: str) -> bool:
        if self.closed or self.ready is None or self.ready[0] != token:
            return False
        _, image_id, wire = self.ready
        self.ready = None
        self.pending_id = None
        self.owned.add(image_id)  # Include a partially written image in exit cleanup.
        self.emit(wire)
        self.current = (image_id, wire)
        for previous in tuple(self.owned - {image_id}):
            self.emit(tmux_wrap(delete_packet(previous), self.layers))
            self.owned.remove(previous)
        return True

    def cancel(self, serial: int) -> None:
        if serial == self.serial:
            self.pending_id = None
            self.ready = None

    def refresh(self) -> bool:
        if self.closed or self.current is None:
            return False
        self.emit(self.current[1])
        return True

    def discard(self) -> bool:
        if self.closed or self.current is None:
            return False
        image_id, _ = self.current
        self.emit(tmux_wrap(delete_packet(image_id), self.layers))
        self.owned.discard(image_id)
        self.current = None
        return True

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            for image_id in tuple(self.owned):
                self.emit(tmux_wrap(delete_packet(image_id), self.layers))
        finally:
            self.owned.clear()
            self.pending_id = None
            self.ready = None
            self.current = None
