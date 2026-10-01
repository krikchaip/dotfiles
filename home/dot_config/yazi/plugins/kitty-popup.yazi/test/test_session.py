"""Deterministic tests for the owned image-session lifecycle.

Run from the repo root in nu:
    with-env { PYTHONDONTWRITEBYTECODE: '1' } {
        python3 -m unittest discover -s home/dot_config/yazi/plugins/kitty-popup.yazi/test -p 'test_session.py' -v
    }

No tmux server, terminal, external program, or temporary state is used.
"""

import base64
import importlib.util
import pathlib
import sys
import unittest


HELPER = pathlib.Path(__file__).resolve().parent.parent / "preview.py"
SPEC = importlib.util.spec_from_file_location("owned_kitty_preview_session", HELPER)
ADAPTER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ADAPTER
SPEC.loader.exec_module(ADAPTER)

ESC = b"\x1b"
ST = ESC + b"\\"
PLACEHOLDER = "\U0010eeee"
# High-byte index 255 was checked against installed kitten icat 0.49.1.
HIGH_BYTE_MARKS = {0: "\u0305", 4: "\u0312", 255: "\ua8e5"}


def frame(image_id, pixels=b"\x00\x11\x22"):
    """Construct a valid icat-shaped frame through the real codec interface."""
    if not pixels or len(pixels) % 3:
        raise AssertionError("RGB fixture must contain complete pixels")
    height = len(pixels) // 3
    header = f"a=T,q=2,f=24,C=1,U=1,s=1,v={height},c=2,r=2,i={image_id}".encode()
    packet = ESC + b"_G" + header + b";" + base64.b64encode(pixels) + ST
    rgb = image_id & 0xFFFFFF
    color = f"\x1b[38:2:{rgb >> 16}:{(rgb >> 8) & 255}:{rgb & 255}m"
    high = HIGH_BYTE_MARKS[image_id >> 24]
    rows = (
        PLACEHOLDER + "\u0305\u0305" + high + PLACEHOLDER + "\u0305\u030d" + high,
        PLACEHOLDER + "\u030d\u0305" + high + PLACEHOLDER + "\u030d\u030d" + high,
    )
    grid = ("\r" + color + "\x1b7\x1b[1;0H" + "\n\r".join(rows) + "\x1b[39m\x1b8").encode()
    return ADAPTER.parse_icat(packet + grid, image_id)


def unwrap_stream(data):
    """Independent decoder for a sequence of documented tmux envelopes."""
    result = bytearray()
    position = 0
    prefix = ESC + b"Ptmux;"
    while position < len(data):
        if not data.startswith(prefix, position):
            raise AssertionError("output contains text or lacks a tmux wrapper")
        position += len(prefix)
        while True:
            if position >= len(data):
                raise AssertionError("unterminated tmux wrapper")
            if data[position] != 27:
                result.append(data[position])
                position += 1
            elif data[position:position + 2] == ESC + ESC:
                result.append(27)
                position += 2
            elif data[position:position + 2] == ST:
                position += 2
                break
            else:
                raise AssertionError("unescaped ESC in tmux wrapper")
    return bytes(result)


def commands(chunks, layers=2):
    """Read native graphics commands without using the production encoder."""
    data = b"".join(chunks)
    for _ in range(layers):
        data = unwrap_stream(data)
    result = []
    while data:
        if not data.startswith(ESC + b"_G"):
            raise AssertionError("output contains non-graphics terminal data")
        end = data.find(ST, 3)
        if end < 0:
            raise AssertionError("unterminated Kitty packet")
        header, payload = data[3:end].split(b";", 1)
        fields = {}
        for entry in header.split(b","):
            key, value = entry.split(b"=", 1)
            key = key.decode("ascii")
            if key in fields:
                raise AssertionError("duplicate Kitty control field")
            fields[key] = value.decode("ascii")
        result.append((fields, payload))
        data = data[end + len(ST):]
    return result


def image_ids(chunks, layers=2):
    return [int(fields["i"]) for fields, _ in commands(chunks, layers) if fields.get("a") in ("T", "t")]


def deleted_ids(chunks, layers=2):
    ids = []
    for fields, payload in commands(chunks, layers):
        if fields.get("a") != "d":
            continue
        if fields.get("d") != "I" or "i" not in fields or fields.get("q") != "2" or payload:
            raise AssertionError("cleanup is not a scoped, reply-suppressed data deletion")
        ids.append(int(fields["i"]))
    return ids


class CaptureEmitter:
    def __init__(self):
        self.completed = []
        self.attempted = []
        self.fail_next = False

    def __call__(self, data):
        self.attempted.append(data)
        if self.fail_next:
            self.fail_next = False
            # An actual terminal writer can send a prefix before raising.
            raise OSError("test-owned partial terminal write")
        self.completed.append(data)

    def clear(self):
        self.completed.clear()
        self.attempted.clear()


class ImageSessionTests(unittest.TestCase):
    def setUp(self):
        self.output = CaptureEmitter()
        ids = iter(range(101, 1000))
        self.session = ADAPTER.ImageSession(layers=2, emit=self.output, new_id=lambda: next(ids))

    def prepare(self, serial=1, pixels=b"\x00\x11\x22"):
        image_id = self.session.begin(serial)
        token = self.session.prepare(serial, frame(image_id, pixels))
        self.assertIsInstance(token, str)
        self.assertTrue(token)
        return image_id, token

    def commit(self, serial=1, pixels=b"\x00\x11\x22"):
        image_id, token = self.prepare(serial, pixels)
        self.assertTrue(self.session.commit(token))
        return image_id, token

    def test_begin_and_prepare_do_not_emit_or_create_visible_resources(self):
        self.prepare()
        self.assertEqual(self.output.completed, [])
        self.assertFalse(self.session.refresh())

    def test_first_commit_emits_only_the_reserved_image(self):
        image_id, _ = self.commit()
        self.assertEqual(image_ids(self.output.completed), [image_id])
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_commit_is_one_shot(self):
        _, token = self.commit()
        previous = b"".join(self.output.completed)
        self.assertFalse(self.session.commit(token))
        self.assertEqual(b"".join(self.output.completed), previous)

    def test_unknown_token_does_not_emit(self):
        self.prepare()
        self.assertFalse(self.session.commit("not-a-session-token"))
        self.assertEqual(self.output.completed, [])

    def test_refresh_without_a_committed_image_does_nothing(self):
        self.assertFalse(self.session.refresh())
        self.assertEqual(self.output.completed, [])

    def test_same_size_refresh_resends_exact_cached_graphics(self):
        self.commit()
        original = b"".join(self.output.completed)
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(b"".join(self.output.completed), original)
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_discard_deletes_only_current_image_and_disables_refresh(self):
        image_id, _ = self.commit()
        self.output.clear()
        self.assertTrue(self.session.discard())
        self.assertEqual(deleted_ids(self.output.completed), [image_id])
        self.assertEqual(self.session.owned, set())
        self.assertFalse(self.session.refresh())
        self.assertFalse(self.session.discard())

    def test_begin_new_preview_preserves_committed_image_for_refresh(self):
        old_id, _ = self.commit()
        self.session.begin(2)
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [old_id])
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_two_commits_replace_image_before_deleting_old_owned_data(self):
        old_id, _ = self.commit()
        self.output.clear()
        new_id, _ = self.commit(2)
        emitted = commands(self.output.completed)
        self.assertEqual(image_ids(self.output.completed), [new_id])
        self.assertEqual(deleted_ids(self.output.completed), [old_id])
        new_position = next(i for i, (fields, _) in enumerate(emitted) if fields.get("a") == "T")
        old_position = next(i for i, (fields, _) in enumerate(emitted) if fields.get("a") == "d")
        self.assertLess(new_position, old_position)

    def test_refresh_after_replacement_resends_only_new_image(self):
        self.commit()
        new_id, _ = self.commit(2)
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [new_id])
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_stale_begin_does_not_advance_or_allocate(self):
        first_id = self.session.begin(10)
        self.assertIsNone(self.session.begin(10))
        self.assertIsNone(self.session.begin(9))
        self.assertEqual(self.session.begin(11), first_id + 1)
        self.assertEqual(self.output.completed, [])

    def test_new_begin_discards_old_ready_token(self):
        _, old_token = self.prepare()
        self.session.begin(2)
        self.assertFalse(self.session.commit(old_token))
        self.assertEqual(self.output.completed, [])

    def test_stale_prepare_is_ignored_before_current_id_validation(self):
        old_id = self.session.begin(1)
        self.session.begin(2)
        self.assertIsNone(self.session.prepare(1, frame(old_id)))
        self.assertEqual(self.output.completed, [])

    def test_stale_commit_cannot_replace_newer_committed_preview(self):
        _, old_token = self.prepare()
        new_id, _ = self.commit(2)
        self.output.clear()
        self.assertFalse(self.session.commit(old_token))
        self.assertEqual(self.output.completed, [])
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [new_id])

    def test_cancel_ready_preview_invalidates_its_token(self):
        _, token = self.prepare()
        self.session.cancel(1)
        self.assertFalse(self.session.commit(token))
        self.assertFalse(self.session.refresh())
        self.assertEqual(self.output.completed, [])

    def test_cancel_preserves_previously_committed_image(self):
        old_id, _ = self.commit()
        _, token = self.prepare(2)
        self.output.clear()
        self.session.cancel(2)
        self.assertFalse(self.session.commit(token))
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [old_id])
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_cancel_committed_serial_does_not_delete_its_cached_image(self):
        old_id, _ = self.commit()
        self.output.clear()
        self.session.cancel(1)
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [old_id])
        self.assertEqual(deleted_ids(self.output.completed), [])

    def test_stale_cancel_does_not_invalidate_current_ready_preview(self):
        self.session.begin(1)
        current_id, token = self.prepare(2)
        self.session.cancel(1)
        self.assertTrue(self.session.commit(token))
        self.assertEqual(image_ids(self.output.completed), [current_id])

    def test_future_cancel_does_not_invalidate_current_ready_preview(self):
        image_id, token = self.prepare()
        self.session.cancel(100)
        self.assertTrue(self.session.commit(token))
        self.assertEqual(image_ids(self.output.completed), [image_id])

    def test_invalid_serials_fail_without_emission(self):
        for serial in (0, -1, True, 1.0, "1", None):
            with self.subTest(serial=serial):
                with self.assertRaises(ValueError):
                    self.session.begin(serial)
        self.assertEqual(self.output.completed, [])

    def test_prepare_rejects_another_image_id_without_creating_resource(self):
        image_id = self.session.begin(1)
        with self.assertRaises(ValueError):
            self.session.prepare(1, frame(image_id + 1))
        self.assertEqual(self.output.completed, [])
        self.assertFalse(self.session.refresh())

    def test_prepare_rejects_wrong_foreground_metadata(self):
        image_id = self.session.begin(1)
        valid = frame(image_id)
        invalid = ADAPTER.Preview(rows=valid.rows, packets=valid.packets, color="#ffffff")
        with self.assertRaises(ValueError):
            self.session.prepare(1, invalid)
        self.assertEqual(self.output.completed, [])

    def test_prepare_rejects_malformed_graphics_packet(self):
        image_id = self.session.begin(1)
        valid = frame(image_id)
        invalid = ADAPTER.Preview(rows=valid.rows, packets=(b"not a graphics packet",), color=valid.color)
        with self.assertRaises(ValueError):
            self.session.prepare(1, invalid)
        self.assertEqual(self.output.completed, [])

    def test_prepare_rejects_cleanup_disguised_as_image(self):
        image_id = self.session.begin(1)
        valid = frame(image_id)
        delete = ESC + f"_Ga=d,d=I,i={image_id},q=2;".encode() + ST
        invalid = ADAPTER.Preview(rows=valid.rows, packets=(delete,), color=valid.color)
        with self.assertRaises(ValueError):
            self.session.prepare(1, invalid)
        self.assertEqual(self.output.completed, [])

    def test_bad_preparation_does_not_destroy_existing_committed_image(self):
        old_id, _ = self.commit()
        new_id = self.session.begin(2)
        with self.assertRaises(ValueError):
            self.session.prepare(2, frame(new_id + 1))
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [old_id])

    def test_close_releases_only_committed_owned_id(self):
        image_id, _ = self.commit()
        self.output.clear()
        self.session.close()
        self.assertEqual(deleted_ids(self.output.completed), [image_id])
        self.assertEqual(image_ids(self.output.completed), [])
        self.assertFalse(self.session.refresh())

    def test_close_is_idempotent_and_invalidates_ready_token(self):
        self.commit()
        _, token = self.prepare(2)
        self.session.close()
        self.output.clear()
        self.session.close()
        self.assertFalse(self.session.commit(token))
        self.assertFalse(self.session.refresh())
        self.assertEqual(self.output.completed, [])

    def test_close_before_any_transmission_does_not_delete_uncreated_images(self):
        self.prepare()
        self.session.close()
        self.assertEqual(self.output.completed, [])
        self.assertFalse(self.session.refresh())

    def test_failed_image_write_retains_old_cache_and_delays_old_deletion(self):
        old_id, _ = self.commit()
        new_id, token = self.prepare(2)
        self.output.clear()
        self.output.fail_next = True
        with self.assertRaises(OSError):
            self.session.commit(token)
        self.assertEqual(deleted_ids(self.output.completed), [])
        self.assertEqual(image_ids(self.output.attempted), [new_id])
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(image_ids(self.output.completed), [old_id])

    def test_close_releases_attempted_partial_image_after_write_failure(self):
        old_id, _ = self.commit()
        attempted_id, token = self.prepare(2)
        self.output.clear()
        self.output.fail_next = True
        with self.assertRaises(OSError):
            self.session.commit(token)
        self.output.clear()
        self.session.close()
        self.assertEqual(set(deleted_ids(self.output.completed)), {old_id, attempted_id})
        self.assertFalse(self.session.refresh())
        self.output.clear()
        self.session.close()
        self.assertEqual(self.output.completed, [])

    def test_full_unsigned_image_namespace_is_preserved_in_scoped_cleanup(self):
        output = CaptureEmitter()
        image_id = 0xFFFFFFFF
        session = ADAPTER.ImageSession(layers=2, emit=output, new_id=lambda: image_id)
        self.assertEqual(session.begin(1), image_id)
        token = session.prepare(1, frame(image_id))
        self.assertTrue(session.commit(token))
        self.assertEqual(image_ids(output.completed), [image_id])
        output.clear()
        session.close()
        self.assertEqual(deleted_ids(output.completed), [image_id])

    def test_allocator_retries_collision_with_a_live_owned_image(self):
        output = CaptureEmitter()
        ids = iter((701, 701, 702))
        session = ADAPTER.ImageSession(layers=2, emit=output, new_id=lambda: next(ids))
        first_id = session.begin(1)
        self.assertTrue(session.commit(session.prepare(1, frame(first_id))))
        self.assertEqual(session.begin(2), 702)

    def test_invalid_allocated_ids_fail_without_emission(self):
        for image_id in (0, -1, 0x100000000, True, 1.0, "1", None):
            with self.subTest(image_id=image_id):
                output = CaptureEmitter()
                session = ADAPTER.ImageSession(layers=2, emit=output, new_id=lambda: image_id)
                with self.assertRaises(ValueError):
                    session.begin(1)
                self.assertEqual(output.completed, [])

    def test_invalid_tmux_layer_counts_are_rejected(self):
        for layers in (-1, 9, True, 1.5, "2", None):
            with self.subTest(layers=layers):
                with self.assertRaises(ValueError):
                    ADAPTER.ImageSession(layers=layers, emit=self.output)
        self.assertEqual(self.output.completed, [])

    def test_transmission_uses_requested_layer_count(self):
        for layers in (0, 1, 2):
            with self.subTest(layers=layers):
                output = CaptureEmitter()
                session = ADAPTER.ImageSession(layers=layers, emit=output, new_id=lambda: 801)
                image_id = session.begin(1)
                self.assertTrue(session.commit(session.prepare(1, frame(image_id))))
                self.assertEqual(image_ids(output.completed, layers), [image_id])
                output.clear()
                session.close()
                self.assertEqual(deleted_ids(output.completed, layers), [image_id])

    def test_refresh_large_image_preserves_payload_and_has_no_terminal_log_replay(self):
        pixels = bytes(range(256)) * 48
        image_id, _ = self.commit(pixels=pixels)
        first_wire = b"".join(self.output.completed)
        emitted = commands(self.output.completed)
        self.assertEqual(base64.b64decode(b"".join(payload for _, payload in emitted), validate=True), pixels)
        self.assertEqual(image_ids(self.output.completed), [image_id])
        for _, payload in emitted:
            self.assertLessEqual(len(payload), 4096)
        native = unwrap_stream(unwrap_stream(first_wire))
        self.assertNotIn(PLACEHOLDER.encode(), native)
        self.assertNotIn(ESC + b"]", native)
        self.assertNotIn(ESC + b"7", native)
        self.output.clear()
        self.assertTrue(self.session.refresh())
        self.assertEqual(b"".join(self.output.completed), first_wire)

    def test_cleanup_contains_no_global_all_placement_deletion(self):
        self.commit()
        self.commit(2)
        self.session.close()
        cleanup = [fields for fields, _ in commands(self.output.completed) if fields.get("a") == "d"]
        self.assertTrue(cleanup)
        self.assertTrue(all(fields.get("d") == "I" and "i" in fields for fields in cleanup))
        self.assertFalse(any(fields.get("d") in ("a", "A") for fields in cleanup))


if __name__ == "__main__":
    unittest.main()
