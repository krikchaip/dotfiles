"""Key filter behavior for each key encoding that Herdr can send to a popup."""

import collections
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from keys import Action, KeyFilter, Tokenizer, parse_combo

# In run() results: bytes that go to the program.
FORWARD = "forward"
HIDE, KILL = Action.HIDE, Action.KILL
PICKER, HELP, SCROLLBACK = Action.PICKER, Action.HELP, Action.SCROLLBACK


def make_filter(toggles=("ctrl+z",), prefix="ctrl+;", scrollback="prefix+e", held=None):
    return KeyFilter(prefix=[prefix], toggle_keys=list(toggles), scrollback=[scrollback],
                     held=held)


def run(key_filter, *chunks):
    """Feed each chunk as one read, then end the input.

    Return the filter's output as a list: (FORWARD, bytes) and (action, b"").
    """
    tokenizer, tokens = Tokenizer(), collections.deque()
    for chunk in chunks:
        tokens.extend(tokenizer.feed(chunk))
    tokens.extend(tokenizer.flush())
    actions = []
    while tokens:
        data, action = key_filter.take(tokens)
        if data:
            actions.append((FORWARD, data))
        if action is not None:
            actions.append((action, b""))
    return actions


class SingleToggleKey(unittest.TestCase):
    def test_legacy_ctrl_z_hides(self):
        self.assertEqual(run(make_filter(), b"\x1a"), [(HIDE, b"")])

    def test_legacy_alt_y_hides(self):
        self.assertEqual(run(make_filter(["alt+y"]), b"\x1by"), [(HIDE, b"")])

    def test_legacy_other_bytes_pass_unchanged(self):
        data = "ls -la\r\x03\x1bb\x7fé€😀".encode()
        self.assertEqual(run(make_filter(["ctrl+z", "alt+y"]), data), [(FORWARD, data)])

    def test_bytes_before_and_after_a_toggle_keep_their_order(self):
        self.assertEqual(run(make_filter(), b"ab\x1acd"),
                         [(FORWARD, b"ab"), (HIDE, b""), (FORWARD, b"cd")])

    def test_kitty_ctrl_z_hides(self):
        self.assertEqual(run(make_filter(), b"\x1b[122;5u"), [(HIDE, b"")])

    def test_kitty_alt_y_with_event_type_hides(self):
        self.assertEqual(run(make_filter(["alt+y"]), b"\x1b[121;3:1u"), [(HIDE, b"")])

    def test_kitty_other_keys_pass_unchanged(self):
        data = b"\x1b[122u\x1b[121;5u\x1b[13;2u\x1b[1;5A\x1b[3~\x1b[57441;2u"
        self.assertEqual(run(make_filter(["ctrl+z", "alt+y"]), data), [(FORWARD, data)])

    def test_kitty_release_of_a_toggle_key_never_reaches_the_program(self):
        self.assertEqual(run(make_filter(), b"\x1b[122;5:1u\x1b[122;5:3u"), [(HIDE, b"")])

    def test_modify_other_keys_ctrl_z_hides(self):
        self.assertEqual(run(make_filter(), b"\x1b[27;5;122~"), [(HIDE, b"")])

    def test_modify_other_keys_alt_y_hides(self):
        self.assertEqual(run(make_filter(["alt+y"]), b"\x1b[27;3;121~"), [(HIDE, b"")])

    def test_modify_other_keys_other_keys_pass_unchanged(self):
        data = b"\x1b[27;5;97~\x1b[27;2;13~"
        self.assertEqual(run(make_filter(), data), [(FORWARD, data)])


# The prefix ctrl+; in each encoding Herdr uses for a popup.
PREFIX = {
    "legacy": b"\x1b[59;5u",  # fixterms, which Herdr sends when no mode is set
    "kitty": b"\x1b[59;5u",
    "kitty-events": b"\x1b[59;5:1u\x1b[59;5:3u",
    "modify-other-keys": b"\x1b[27;5;59~",
}
F = {"legacy": b"f", "kitty": b"f", "kitty-events": b"\x1b[102;1:1u\x1b[102;1:3u",
     "modify-other-keys": b"f"}
Q = {"legacy": b"q", "kitty": b"q", "kitty-events": b"\x1b[113u", "modify-other-keys": b"q"}
QUESTION = {"legacy": b"?", "kitty": b"?", "kitty-events": b"\x1b[47:63;2u",
            "modify-other-keys": b"?"}


class PrefixChords(unittest.TestCase):
    def check(self, toggles, keys, expected):
        for encoding in PREFIX:
            with self.subTest(encoding=encoding):
                chunks = [PREFIX[encoding] if key == "prefix" else key[encoding] for key in keys]
                self.assertEqual(run(make_filter(toggles), *chunks), expected)

    def test_prefix_f_toggle_hides(self):
        self.check(["prefix+f"], ["prefix", F], [(HIDE, b"")])

    def test_prefix_q_kills(self):
        self.check([], ["prefix", Q], [(KILL, b"")])

    def test_prefix_question_mark_opens_help(self):
        self.check([], ["prefix", QUESTION], [(HELP, b"")])

    def test_prefix_g_opens_the_picker(self):
        self.assertEqual(run(make_filter(), PREFIX["kitty"], b"g"), [(PICKER, b"")])

    def test_prefix_e_opens_scrollback_from_config(self):
        self.assertEqual(run(make_filter(), PREFIX["kitty"], b"e"), [(SCROLLBACK, b"")])

    def test_empty_scrollback_key_forwards_prefix_e(self):
        key_filter = KeyFilter(prefix=["ctrl+;"], toggle_keys=[], scrollback=[""])
        self.assertEqual(run(key_filter, b"\x1b[59;5u", b"e"), [(FORWARD, b"\x1b[59;5ue")])

    def test_prefix_prefix_sends_one_literal_prefix(self):
        for encoding, prefix in PREFIX.items():
            with self.subTest(encoding=encoding):
                self.assertEqual(run(make_filter(), prefix, prefix), [(FORWARD, prefix)])

    def test_other_prefix_chord_forwards_both_keys(self):
        for encoding, prefix in PREFIX.items():
            with self.subTest(encoding=encoding):
                self.assertEqual(run(make_filter(), prefix, b"x"), [(FORWARD, prefix + b"x")])

    def test_prefix_chord_is_not_a_single_key_toggle(self):
        self.assertEqual(run(make_filter(["prefix+f"]), b"f"), [(FORWARD, b"f")])

    def test_modifier_key_events_wait_with_the_prefix(self):
        shift = b"\x1b[57441;2u"
        self.assertEqual(run(make_filter(), PREFIX["kitty"], shift, b"\x1b[47:63;2u"),
                         [(HELP, b"")])

    def test_prefix_from_config_list_and_legacy_control_byte(self):
        key_filter = KeyFilter(prefix=["ctrl+a", "ctrl+;"], toggle_keys=["prefix+f"])
        self.assertEqual(run(key_filter, b"\x01f"), [(HIDE, b"")])

    def test_single_toggle_key_still_works_after_a_forwarded_chord(self):
        self.assertEqual(run(make_filter(), PREFIX["kitty"], b"x", b"\x1a"),
                         [(FORWARD, PREFIX["kitty"] + b"x"), (HIDE, b"")])


class HeldKeys(unittest.TestCase):
    """Kitty report-all-keys mode: a key that the program did not see stays unseen."""

    ENTER_PRESS, ENTER_RELEASE = b"\x1b[13;1:1u", b"\x1b[13;1:3u"

    def test_a_release_with_other_modifiers_still_belongs_to_the_toggle_key(self):
        # ctrl comes up before z: the z release has no ctrl.
        data = b"\x1b[122;5:1u\x1b[57442;5:1u\x1b[57442;1:3u\x1b[122;1:3u"
        self.assertEqual(run(make_filter(), data), [(HIDE, b""), (FORWARD, data[10:-10])])

    def test_a_key_held_by_a_popup_page_does_not_reach_the_next_viewer(self):
        # The picker took the enter press. The release comes after the switch.
        held = {("enter", None)}
        key_filter = KeyFilter(["ctrl+;"], [], held=held)
        self.assertEqual(run(key_filter, self.ENTER_RELEASE, b"a"), [(FORWARD, b"a")])
        self.assertEqual(held, set())

    def test_a_new_press_for_the_program_ends_the_hold(self):
        held = {("enter", None)}
        key_filter = KeyFilter(["ctrl+;"], [], held=held)
        data = self.ENTER_PRESS + self.ENTER_RELEASE
        self.assertEqual(run(key_filter, data), [(FORWARD, data)])

    def test_a_modifier_pressed_inside_a_chord_is_held(self):
        shift_press, shift_release = b"\x1b[57441;2u", b"\x1b[57441;1:3u"
        held = set()
        self.assertEqual(run(make_filter(held=held), PREFIX["kitty"], shift_press,
                             b"\x1b[47:63;2u"), [(HELP, b"")])
        self.assertEqual(run(make_filter(held=held), shift_release, b"\x1b[47;1:3u"), [])

    def test_the_prefix_release_passes_after_a_chord_that_is_forwarded(self):
        data = b"\x1b[59;5:1u\x1b[120u"
        release = b"\x1b[59;1:3u"
        self.assertEqual(run(make_filter(), data, release), [(FORWARD, data + release)])


    def test_a_release_of_a_key_the_program_got_reaches_it_during_a_chord(self):
        # ctrl goes down for the program, then ctrl+; starts the prefix, and ctrl
        # comes up before q. The program got the ctrl press, so it gets the release.
        ctrl_press, ctrl_release = b"\x1b[57442;5:1u", b"\x1b[57442;1:3u"
        data = ctrl_press + b"\x1b[59;5:1u" + ctrl_release + b"\x1b[113;1:1u"
        self.assertEqual(run(make_filter(), data),
                         [(FORWARD, ctrl_press + ctrl_release), (KILL, b"")])


class PageMode(unittest.TestCase):
    """On a popup page, popup keys act as in the program, and nothing goes to the program."""

    def test_popup_keys_act_on_a_page(self):
        held = set()
        page = KeyFilter(["ctrl+;"], ["ctrl+z"], held=held, to_program=False)
        self.assertEqual(run(page, b"\x1a"), [(HIDE, b"")])
        self.assertEqual(run(page, PREFIX["kitty"], b"q"), [(KILL, b"")])

    def test_every_press_on_a_page_is_held(self):
        held = set()
        page = KeyFilter(["ctrl+;"], [], held=held, to_program=False)
        tokens = collections.deque(Tokenizer().feed(b"\x1b[59;5:1ux"))
        data, action = page.take(tokens)
        self.assertEqual((data, action), (b"\x1b[59;5:1ux", None))
        self.assertEqual(held, {(";", None), ("x", None)})


class InputThatIsNotAKey(unittest.TestCase):
    def test_bracketed_paste_passes_unchanged_even_with_toggle_bytes(self):
        data = b"\x1b[200~a\x1ab\x1b[59;5uq\x1b[201~"
        actions = run(make_filter(), data[:9], data[9:20], data[20:])
        self.assertEqual({action for action, _ in actions}, {FORWARD})
        self.assertEqual(b"".join(raw for _, raw in actions), data)

    def test_terminal_replies_and_mouse_pass_unchanged(self):
        data = (b"\x1b[?1u\x1b[?62;22c\x1b]11;rgb:0000/0000/0000\x1b\\"
                b"\x1b_Gi=31;OK\x1b\\\x1b[<0;10;5M\x1b[I\x1b[M !!")
        self.assertEqual(run(make_filter(), data), [(FORWARD, data)])

    def test_sequence_split_across_reads_is_still_found(self):
        self.assertEqual(run(make_filter(), b"\x1b[12", b"2;5u"), [(HIDE, b"")])

    def test_unfinished_sequence_is_forwarded_on_flush(self):
        self.assertEqual(run(make_filter(), b"\x1b[1;"), [(FORWARD, b"\x1b[1;")])
        self.assertEqual(run(make_filter(), b"\x1b"), [(FORWARD, b"\x1b")])

    def test_lone_escape_is_the_esc_key_after_the_wait(self):
        self.assertEqual(run(make_filter(["esc"]), b"\x1b"), [(HIDE, b"")])

    def test_take_stops_at_the_first_popup_key(self):
        tokens = collections.deque(Tokenizer().feed(b"ab\x1acd"))
        self.assertEqual(make_filter().take(tokens), (b"ab", HIDE))
        self.assertEqual(b"".join(token.raw for token in tokens), b"cd")

    def test_invalid_utf8_passes_unchanged(self):
        self.assertEqual(run(make_filter(), b"\xff\xfe"), [(FORWARD, b"\xff\xfe")])


class KeySyntax(unittest.TestCase):
    def test_invalid_toggle_key_is_an_error(self):
        for text in ("ctrl+", "ctrl+foo", "a+b", ""):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    KeyFilter(prefix=["ctrl+;"], toggle_keys=[text])

    def test_a_combo_label_is_herdr_key_syntax(self):
        # An uppercase letter means shift, as in Herdr: ctrl+B is shift+ctrl+b.
        for text, label in (("q", "q"), ("?", "?"), ("CTRL+b", "ctrl+b"),
                            ("ctrl+B", "shift+ctrl+b"), ("alt+shift+x", "shift+alt+x"),
                            ("cmd+enter", "super+enter")):
            with self.subTest(text=text):
                self.assertEqual(parse_combo(text).label, label)
                self.assertEqual(parse_combo(label), parse_combo(text))


if __name__ == "__main__":
    unittest.main()
