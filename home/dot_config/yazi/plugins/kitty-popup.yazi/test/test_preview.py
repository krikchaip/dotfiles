"""Deterministic tests at the owned Kitty-preview codec interface.

Run from the repo root in nu:
    with-env { PYTHONDONTWRITEBYTECODE: '1' } {
        python3 -m unittest discover -s home/dot_config/yazi/plugins/kitty-popup.yazi/test -p 'test_*.py' -v
    }

No terminal, tmux server, external executable, or mock adapter is used.
"""

import base64
import importlib.util
import pathlib
import random
import sys
import unittest


HELPER = pathlib.Path(__file__).resolve().parent.parent / "preview.py"
SPEC = importlib.util.spec_from_file_location("owned_kitty_preview_codec", HELPER)
CODEC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CODEC
SPEC.loader.exec_module(CODEC)

ESC = b"\x1b"
ST = ESC + b"\\"
PLACEHOLDER = "\U0010eeee"
IMAGE_ID = 81234325  # 0x04d78995: nonzero high byte, from the live fixture.
ROW_0 = PLACEHOLDER + "\u0305\u0305\u0312" + PLACEHOLDER + "\u0305\u030d\u0312"
ROW_1 = PLACEHOLDER + "\u030d\u0305\u0312" + PLACEHOLDER + "\u030d\u030d\u0312"


def image_packet(payload=b"AQID", image_id=IMAGE_ID, extra=""):
    header = f"a=T,q=2,f=24,C=1,U=1,s=1,v=1,c=2,r=2,i={image_id}{extra}"
    return ESC + b"_G" + header.encode("ascii") + b";" + payload + ST


def grid(rows=(ROW_0, ROW_1), image_id=IMAGE_ID):
    color = image_id & 0xFFFFFF
    red, green, blue = color >> 16, (color >> 8) & 255, color & 255
    # These cursor/SGR wrappers match the observed kitten icat output.
    prefix = f"\r\x1b[38:2:{red}:{green}:{blue}m\x1b7\x1b[4;0H\x1b[27C"
    middle = "\n\r\x1b[27C".join(rows)
    return (prefix + middle + "\x1b[39m\x1b8").encode("utf-8")


def fields_and_payload(packet):
    """Read the wire format as an independent test oracle."""
    if not packet.startswith(ESC + b"_G") or not packet.endswith(ST):
        raise AssertionError("output is not a complete native Kitty APC")
    header, payload = packet[3:-2].split(b";", 1)
    fields = {}
    for entry in header.split(b","):
        key, value = entry.split(b"=", 1)
        key = key.decode("ascii")
        if key in fields:
            raise AssertionError("output contains duplicate control keys")
        fields[key] = value.decode("ascii")
    return fields, payload


def unwrap_one(data):
    """Decode one documented tmux envelope, rather than reusing the codec."""
    prefix = ESC + b"Ptmux;"
    if not data.startswith(prefix) or not data.endswith(ST):
        raise AssertionError("missing tmux passthrough envelope")
    body = data[len(prefix):-2]
    result = bytearray()
    index = 0
    while index < len(body):
        if body[index] == 27:
            if body[index:index + 2] != ESC + ESC:
                raise AssertionError("unescaped ESC in envelope body")
            result.append(27)
            index += 2
        else:
            result.append(body[index])
            index += 1
    return bytes(result)


class TmuxWrapTests(unittest.TestCase):
    def test_zero_layers_preserves_binary_data(self):
        data = b"\x00\xff" + ESC + b"_Gm=0;AQID" + ST
        self.assertEqual(CODEC.tmux_wrap(data, 0), data)

    def test_one_layer_matches_a_literal_protocol_example(self):
        actual = CODEC.tmux_wrap(b"\x1b_Ga=T;AQID\x1b\\", 1)
        self.assertEqual(actual, b"\x1bPtmux;\x1b\x1b_Ga=T;AQID\x1b\x1b\\\x1b\\")

    def test_two_layers_match_a_literal_protocol_example(self):
        actual = CODEC.tmux_wrap(b"\x1b_Ga=T;AQID\x1b\\", 2)
        self.assertEqual(
            actual,
            b"\x1bPtmux;\x1b\x1bPtmux;\x1b\x1b\x1b\x1b_Ga=T;AQID"
            b"\x1b\x1b\x1b\x1b\\\x1b\x1b\\\x1b\\",
        )

    def test_each_layer_can_be_removed_without_changing_the_packet(self):
        data = image_packet() + b"\x00\xff\x1bPtext\x1b\\\x1b\x1b"
        for layers in range(9):
            with self.subTest(layers=layers):
                actual = CODEC.tmux_wrap(data, layers)
                for _ in range(layers):
                    actual = unwrap_one(actual)
                self.assertEqual(actual, data)

    def test_empty_data_can_cross_two_layers(self):
        self.assertEqual(unwrap_one(unwrap_one(CODEC.tmux_wrap(b"", 2))), b"")

    def test_invalid_layer_counts_are_rejected(self):
        for layers in (-1, 9, 1.5, "2", None):
            with self.subTest(layers=layers), self.assertRaises(ValueError):
                CODEC.tmux_wrap(image_packet(), layers)


class SplitGraphicsPacketTests(unittest.TestCase):
    def assert_transfer(self, raw, limit):
        encoded = base64.b64encode(raw)
        original = image_packet(encoded)
        chunks = CODEC.split_graphics_packet(original, max_payload=limit)
        self.assertIsInstance(chunks, list)
        self.assertTrue(chunks)
        original_fields, _ = fields_and_payload(original)
        bodies = []
        for index, chunk in enumerate(chunks):
            fields, body = fields_and_payload(chunk)
            self.assertLessEqual(len(body), limit)
            self.assertEqual(len(body) % 4, 0)
            if len(chunks) > 1:
                self.assertEqual(fields["m"], "0" if index == len(chunks) - 1 else "1")
            else:
                self.assertEqual(chunk, original)
            if index == 0:
                self.assertEqual({k: v for k, v in fields.items() if k != "m"}, original_fields)
            else:
                self.assertLessEqual(set(fields), {"m", "q"})
            if index < len(chunks) - 1:
                self.assertNotIn(b"=", body)
            bodies.append(body)
        self.assertEqual(b"".join(bodies), encoded)
        self.assertEqual(base64.b64decode(b"".join(bodies), validate=True), raw)
        return chunks

    def test_tiny_packet_retains_exact_original_wire_bytes(self):
        chunks = self.assert_transfer(b"\x01\x02\x03", 4096)
        self.assertEqual(len(chunks), 1)

    def test_exact_4096_boundary_uses_one_chunk(self):
        self.assertEqual(len(self.assert_transfer(bytes(range(256)) * 12, 4096)), 1)

    def test_one_base64_unit_over_boundary_uses_two_chunks(self):
        chunks = self.assert_transfer(bytes(range(256)) * 12 + b"abc", 4096)
        self.assertEqual([len(fields_and_payload(p)[1]) for p in chunks], [4096, 4])

    def test_exact_two_chunk_boundary_uses_two_chunks(self):
        self.assertEqual(len(self.assert_transfer(bytes(range(256)) * 24, 4096)), 2)

    def test_large_image_has_only_four_byte_aligned_chunks(self):
        chunks = self.assert_transfer(bytes(range(256)) * 64, 4096)
        self.assertGreater(len(chunks), 4)

    def test_small_limits_preserve_base64_padding(self):
        for raw in (b"x", b"xy", b"xyz", b"abcd", b"abcde", b"abcdef"):
            for limit in (4, 8, 12):
                with self.subTest(size=len(raw), limit=limit):
                    self.assert_transfer(raw, limit)

    def test_explicit_final_m_flag_does_not_create_duplicate_keys(self):
        chunks = CODEC.split_graphics_packet(image_packet(extra=",m=0"), max_payload=4)
        fields, body = fields_and_payload(chunks[-1])
        self.assertEqual(fields["m"], "0")
        self.assertEqual(body, b"AQID")

    def test_already_multipart_input_remains_open_after_splitting(self):
        payload = base64.b64encode(bytes(range(256)) * 24)
        original = image_packet(payload, extra=",m=1")
        chunks = CODEC.split_graphics_packet(original)
        self.assertEqual(len(chunks), 2)
        self.assertEqual([fields_and_payload(p)[0]["m"] for p in chunks], ["1", "1"])
        self.assertEqual(b"".join(fields_and_payload(p)[1] for p in chunks), payload)

    def test_small_already_multipart_input_is_unchanged(self):
        original = image_packet(extra=",m=1")
        self.assertEqual(CODEC.split_graphics_packet(original), [original])

    def test_empty_cleanup_command_and_multipart_terminator_are_preserved(self):
        for original in (b"\x1b_Ga=d,d=I,i=81234325,q=2;\x1b\\", b"\x1b_Gm=0;\x1b\\"):
            with self.subTest(packet=original):
                self.assertEqual(CODEC.split_graphics_packet(original), [original])

    def test_malformed_packet_frames_are_rejected(self):
        cases = (b"", b"AQID", b"\x1b_Ga=T;AQID", b"\x1b_Ga=T;AQID\x07", b"\x1b_Pa=T;AQID\x1b\\", image_packet() + b"trailer", image_packet() + image_packet())
        for packet in cases:
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                CODEC.split_graphics_packet(packet)

    def test_kitten_unpadded_base64_is_preserved(self):
        for raw in (b"x", b"xy", bytes(range(256)) * 24 + b"x"):
            payload = base64.b64encode(raw).rstrip(b"=")
            chunks = CODEC.split_graphics_packet(image_packet(payload))
            actual = b"".join(fields_and_payload(p)[1] for p in chunks)
            self.assertEqual(actual, payload)
            self.assertEqual(base64.b64decode(actual + b"=" * (-len(actual) % 4)), raw)
            for chunk in chunks[:-1]:
                self.assertEqual(len(fields_and_payload(chunk)[1]) % 4, 0)

    def test_invalid_base64_is_rejected(self):
        for payload in (b"!QID", b"A", b"AQID\n", b"AQ==BA==", b"A===", b"\xff\xff\xff\xff"):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                CODEC.split_graphics_packet(image_packet(payload))

    def test_invalid_payload_limits_are_rejected(self):
        for limit in (-4, 0, 1, 3, 4.5, "4096", None):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                CODEC.split_graphics_packet(image_packet(), max_payload=limit)

    def test_seeded_sizes_reassemble_exact_original_pixels(self):
        random_source = random.Random(0x4B4750)
        for _ in range(32):
            size = random_source.randrange(1, 15000)
            raw = random_source.randbytes(size)
            limit = random_source.choice((4, 64, 256, 4096))
            with self.subTest(size=size, limit=limit):
                self.assert_transfer(raw, limit)


class ParseIcatTests(unittest.TestCase):
    def test_animated_gif_keeps_first_frame_and_discards_scoped_animation(self):
        first = image_packet()
        animation = (
            b"\x1b_Ga=a,r=1,i=81234325,z=70\x1b\\"
            b"\x1b_Ga=f,q=2,f=32,s=1,v=1,i=81234325,z=70;BAUG\x1b\\"
            b"\x1b_Ga=a,s=2,r=1,i=81234325,z=70\x1b\\"
            b"\x1b_Ga=a,s=3,r=1,i=81234325,z=70\x1b\\"
        )
        preview = CODEC.parse_icat(first + animation + grid(), IMAGE_ID)
        self.assertEqual(preview.packets, (first,))
        self.assertEqual(preview.rows, (ROW_0, ROW_1))

    def test_discarded_animation_cannot_target_another_image_or_transfer_files(self):
        packets = (
            b"\x1b_Ga=a,i=81234326,s=3\x1b\\",
            b"\x1b_Ga=f,i=81234326,q=2;BAUG\x1b\\",
            b"\x1b_Ga=f,i=81234325,t=f,q=2;BAUG\x1b\\",
            b"\x1b_Ga=a,i=81234325,q=1,s=3\x1b\\",
            b"\x1b_Ga=a,i=81234325,s=3;BAUG\x1b\\",
        )
        for packet in packets:
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                CODEC.parse_icat(image_packet() + packet + grid(), IMAGE_ID)

    def test_discarded_animation_frame_can_have_multipart_continuations(self):
        animation = (
            b"\x1b_Ga=f,q=2,i=81234325,m=1;BAUG\x1b\\"
            b"\x1b_Ga=f,q=2,m=0;Bwg\x1b\\"
        )
        first = image_packet()
        self.assertEqual(CODEC.parse_icat(first + animation + grid(), IMAGE_ID).packets, (first,))

    def test_stray_or_incomplete_animation_continuation_is_rejected(self):
        for animation in (b"\x1b_Gm=0;BAUG\x1b\\", b"\x1b_Ga=f,q=2,i=81234325,m=1;BAUG\x1b\\"):
            with self.subTest(packet=animation), self.assertRaises(ValueError):
                CODEC.parse_icat(image_packet() + animation + grid(), IMAGE_ID)

    def test_live_shaped_high_bit_id_keeps_exact_placeholder_metadata(self):
        packet = image_packet()
        preview = CODEC.parse_icat(packet + grid(), IMAGE_ID)
        self.assertEqual(preview.rows, (ROW_0, ROW_1))
        self.assertEqual(preview.packets, (packet,))
        self.assertEqual(preview.color, "#d78995")

    def test_row_tuple_contains_no_terminal_controls(self):
        preview = CODEC.parse_icat(image_packet() + grid(), IMAGE_ID)
        self.assertIsInstance(preview.rows, tuple)
        for row in preview.rows:
            self.assertNotIn("\x1b", row)
            self.assertNotIn("\r", row)
            self.assertNotIn("\n", row)
            self.assertEqual(row.count(PLACEHOLDER), 2)

    def test_semicolon_truecolor_wrapper_is_supported(self):
        data = image_packet() + grid().replace(b"38:2:215:137:149", b"38;2;215;137;149")
        self.assertEqual(CODEC.parse_icat(data, IMAGE_ID).rows, (ROW_0, ROW_1))

    def test_plain_placeholder_rows_need_no_cursor_wrappers(self):
        data = image_packet() + (ROW_0 + "\n" + ROW_1).encode()
        self.assertEqual(CODEC.parse_icat(data, IMAGE_ID).rows, (ROW_0, ROW_1))

    def test_single_placeholder_row_is_preserved(self):
        self.assertEqual(CODEC.parse_icat(image_packet() + grid((ROW_0,)), IMAGE_ID).rows, (ROW_0,))

    def test_low_24_bit_image_id_uses_literal_foreground_color(self):
        image_id = 7340101
        row = PLACEHOLDER + "\u0305\u0305\u0305"
        preview = CODEC.parse_icat(image_packet(image_id=image_id) + grid((row,), image_id), image_id)
        self.assertEqual(preview.color, "#700045")
        self.assertEqual(preview.rows, (row,))

    def test_multipart_native_packets_remain_in_wire_order(self):
        first = image_packet(extra=",m=1")
        second = b"\x1b_Gm=0;BAUG\x1b\\"
        preview = CODEC.parse_icat(first + second + grid(), IMAGE_ID)
        self.assertEqual(preview.packets, (first, second))
        self.assertEqual(preview.rows, (ROW_0, ROW_1))

    def test_wrong_initial_image_id_is_rejected(self):
        with self.assertRaises(ValueError):
            CODEC.parse_icat(image_packet(image_id=IMAGE_ID + 1) + grid(), IMAGE_ID)

    def test_zero_or_oversized_requested_image_ids_are_rejected(self):
        for image_id in (0, -1, 2**32, 1.5, "7340101", None):
            with self.subTest(image_id=image_id), self.assertRaises(ValueError):
                CODEC.parse_icat(image_packet() + grid(), image_id)

    def test_missing_native_image_data_is_rejected(self):
        with self.assertRaises(ValueError):
            CODEC.parse_icat(grid(), IMAGE_ID)

    def test_missing_placeholder_rows_are_rejected(self):
        with self.assertRaises(ValueError):
            CODEC.parse_icat(image_packet(), IMAGE_ID)

    def test_non_placeholder_text_cannot_become_a_preview_row(self):
        for suffix in (b"unexpected text", b"\nnot a placeholder\n", "prefix".encode() + ROW_0.encode(), ROW_0.encode() + b"suffix"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                CODEC.parse_icat(image_packet() + suffix, IMAGE_ID)

    def test_invalid_utf8_is_rejected(self):
        with self.assertRaises(ValueError):
            CODEC.parse_icat(image_packet() + grid() + b"\xff", IMAGE_ID)

    def test_unterminated_native_packet_is_rejected(self):
        with self.assertRaises(ValueError):
            CODEC.parse_icat(image_packet()[:-2] + grid(), IMAGE_ID)

    def test_clipboard_and_other_terminal_side_effects_are_rejected(self):
        controls = (
            b"\x1b]52;c;Y2xpcGJvYXJk\x07",
            b"\x1b]52;c;Y2xpcGJvYXJk\x1b\\",
            b"\x1b]0;new title\x07",
            b"\x1bPtmux;secret\x1b\\",
            b"\x1b_Xarbitrary\x1b\\",
            b"\x1b[2J",
            b"\x1b[?25h",
            b"\x07",
            b"\x1b",
        )
        for control in controls:
            with self.subTest(control=control), self.assertRaises(ValueError):
                CODEC.parse_icat(image_packet() + control + grid(), IMAGE_ID)

    def test_transmission_only_initial_action_is_supported(self):
        packet = image_packet().replace(b"a=T,", b"a=t,", 1)
        self.assertEqual(CODEC.parse_icat(packet + grid(), IMAGE_ID).packets, (packet,))

    def test_kitten_repeats_transmit_action_on_continuations(self):
        first = image_packet(extra=",m=1")
        middle = b"\x1b_Ga=T,q=2,m=1;BAUG\x1b\\"
        final = b"\x1b_Ga=T,q=2,m=0;Bwg\x1b\\"
        packets = (first, middle, final)
        self.assertEqual(CODEC.parse_icat(b"".join(packets) + grid(), IMAGE_ID).packets, packets)

    def test_continuation_cannot_change_action_or_enable_replies(self):
        first = image_packet(extra=",m=1")
        for final in (b"\x1b_Ga=d,q=2,m=0;BAUG\x1b\\", b"\x1b_Ga=T,q=1,m=0;BAUG\x1b\\"):
            with self.subTest(packet=final), self.assertRaises(ValueError):
                CODEC.parse_icat(first + final + grid(), IMAGE_ID)

    def test_empty_multipart_final_terminator_is_supported(self):
        first = image_packet(extra=",m=1")
        final = b"\x1b_Gm=0;\x1b\\"
        self.assertEqual(CODEC.parse_icat(first + final + grid(), IMAGE_ID).packets, (first, final))

    def test_initial_packet_requires_virtual_placement_and_suppressed_replies(self):
        original = image_packet()
        packets = (
            original.replace(b"q=2,", b"", 1),
            original.replace(b"q=2,", b"q=0,", 1),
            original.replace(b"q=2,", b"q=1,", 1),
            original.replace(b"U=1,", b"", 1),
            original.replace(b"U=1,", b"U=0,", 1),
        )
        for packet in packets:
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                CODEC.parse_icat(packet + grid(), IMAGE_ID)

    def test_unrelated_action_after_valid_transfer_is_rejected(self):
        extra = b"\x1b_Ga=d,d=A,q=2;\x1b\\"
        with self.assertRaises(ValueError):
            CODEC.parse_icat(image_packet() + extra + grid(), IMAGE_ID)

    def test_arbitrary_kitty_command_cannot_be_forwarded_as_image_data(self):
        commands = (
            b"\x1b_Ga=d,d=A,q=2;\x1b\\",
            b"\x1b_Ga=q,i=81234325;AQID\x1b\\",
            b"\x1b_Ga=T,i=81234325,t=f;L3RtcC9maWxl\x1b\\",
        )
        for command in commands:
            with self.subTest(command=command), self.assertRaises(ValueError):
                CODEC.parse_icat(command + grid(), IMAGE_ID)


class ClearPlaceholderCellsTests(unittest.TestCase):
    def test_clears_only_remaining_placeholders_and_preserves_new_text(self):
        screen = "left│" + PLACEHOLDER + "\u0305" + PLACEHOLDER + "\u030d" + "  │\n" + "left│Text" + PLACEHOLDER + "\u0305" + "│"
        self.assertEqual(
            CODEC.clear_placeholder_cells(screen, 5, 0, (4, 5)),
            b"\x1b7\x1b[1;6H  \x1b[2;10H \x1b8",
        )

    def test_handles_wide_cells_before_the_preview(self):
        screen = "界abc" + PLACEHOLDER + "\u0305" + PLACEHOLDER
        self.assertEqual(CODEC.clear_placeholder_cells(screen, 5, 0, (2,)), b"\x1b7\x1b[1;6H  \x1b8")

    def test_no_placeholder_needs_no_terminal_write(self):
        self.assertEqual(CODEC.clear_placeholder_cells("text only", 0, 0, (9,)), b"")

    def test_rejects_invalid_area(self):
        for args in ((-1, 0, (1,)), (0, -1, (1,)), (0, 0, (-1,)), (True, 0, (1,))):
            with self.subTest(args=args), self.assertRaises(ValueError):
                CODEC.clear_placeholder_cells("", *args)


if __name__ == "__main__":
    unittest.main()
