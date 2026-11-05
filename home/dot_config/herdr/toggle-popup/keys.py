"""Decode terminal key input and find popup keys in it.

Herdr encodes each key for the popup with the keyboard mode that the program
in the backing pane asked for: legacy bytes, the kitty keyboard protocol, or
xterm modifyOtherKeys. The filter reads all three. It never changes bytes that
it does not use.
"""

import enum
import re

SHIFT, ALT, CTRL, SUPER = 1, 2, 4, 8
MODIFIER_MASK = SHIFT | ALT | CTRL | SUPER

PRESS, REPEAT, RELEASE = 1, 2, 3
# The Key name of a modifier key alone, as kitty reports it with report-all-keys.
MODIFIER_KEY = "modifier"


class Action(enum.Enum):
    HIDE = "hide"
    KILL = "kill"
    PICKER = "picker"
    HELP = "help"
    SCROLLBACK = "scrollback"


class Key:
    """One decoded key event. `name` is a lowercase char or a named key.

    `code` is the kitty key code of a modifier key alone, else None.
    """

    __slots__ = ("name", "mods", "kind", "shifted", "code")

    def __init__(self, name, mods=0, kind=PRESS, shifted=None, code=None):
        self.name = name
        self.mods = mods & MODIFIER_MASK
        self.kind = kind
        self.shifted = shifted
        self.code = code

    def __repr__(self):
        return f"Key({self.name!r}, mods={self.mods}, kind={self.kind})"

    @property
    def combo(self):
        """The key and its modifiers, without the event kind."""
        return Combo(self.name, self.mods)

    @property
    def hold(self):
        """The physical key, as the held-key set keeps it.

        A press and its release can have other modifiers: ctrl can come up
        before z. So only the key itself counts here.
        """
        return (self.name, self.code)


class Combo:
    """One key with modifiers, as written in Herdr key syntax."""

    __slots__ = ("name", "mods")

    def __init__(self, name, mods):
        self.name = name
        self.mods = mods

    def __eq__(self, other):
        return isinstance(other, Combo) and (self.name, self.mods) == (other.name, other.mods)

    def __hash__(self):
        return hash((self.name, self.mods))

    def __repr__(self):
        return f"Combo({self.name!r}, {self.mods})"

    @property
    def label(self):
        """The combo in Herdr key syntax, such as `ctrl+b` or `q`."""
        names = [name for bit, name in MODIFIER_LABELS if self.mods & bit]
        return "+".join(names + [self.name])

    def matches(self, key):
        if key.name == self.name and key.mods == self.mods:
            return True
        # Shift that produced a character is part of the character: shift+/ is "?".
        if key.mods & SHIFT and key.mods & ~SHIFT == self.mods:
            produced = key.shifted or US_SHIFTED.get(key.name)
            return produced == self.name
        return False


US_SHIFTED = dict(zip("`1234567890-=[]\\;',./", '~!@#$%^&*()_+{}|:"<>?', strict=True))
US_SHIFTED.update((c, c.upper()) for c in "abcdefghijklmnopqrstuvwxyz")

MODIFIER_LABELS = ((SHIFT, "shift"), (ALT, "alt"), (CTRL, "ctrl"), (SUPER, "super"))
MODIFIER_NAMES = {
    "ctrl": CTRL, "control": CTRL, "shift": SHIFT, "alt": ALT, "option": ALT,
    "meta": ALT, "cmd": SUPER, "command": SUPER, "super": SUPER,
}
KEY_ALIASES = {
    "space": " ", "return": "enter", "escape": "esc", "bs": "backspace",
    "minus": "-", "comma": ",", "period": ".", "slash": "/", "backslash": "\\",
    "quote": "'", "double_quote": '"', "double-quote": '"', "semicolon": ";",
    "colon": ":", "percent": "%", "ampersand": "&", "backtick": "`", "plus": "+",
}
NAMED_KEYS = {"enter", "esc", "tab", "backtab", "backspace", "left", "right", "up",
              "down", "home", "end", "insert", "delete", "pageup", "pagedown"}
NAMED_KEYS.update(f"f{n}" for n in range(1, 25))


def parse_combo(text):
    """Parse one Herdr key such as `ctrl+;`, `alt+y`, or `shift+tab`."""
    text = text.strip()
    if text == "+":
        return Combo("+", 0)
    if text.endswith("++"):
        parts, name = text[:-2].split("+"), "+"
    else:
        parts = text.split("+")
        name = None
    mods = 0
    for part in [p.strip() for p in parts]:
        if not part:
            raise ValueError(f"invalid key: {text!r}")
        if part.lower() in MODIFIER_NAMES:
            mods |= MODIFIER_NAMES[part.lower()]
        elif name is None:
            name = part
        else:
            raise ValueError(f"invalid key: {text!r}")
    if name is None:
        raise ValueError(f"invalid key: {text!r}")
    lower = name.lower()
    if lower in KEY_ALIASES:
        name = KEY_ALIASES[lower]
    elif lower in NAMED_KEYS:
        name = lower
    elif len(name) == 1:
        if name.isascii() and name.isupper():
            mods |= SHIFT
            name = name.lower()
    else:
        raise ValueError(f"invalid key: {text!r}")
    if name == "tab" and mods & SHIFT:
        name, mods = "backtab", mods & ~SHIFT
    return Combo(name, mods)


# Legacy control bytes. Tab, Enter, and Esc keep their own names.
C0_KEYS = {0x00: Key(" ", CTRL), 0x09: Key("tab"), 0x0D: Key("enter"), 0x1B: Key("esc"),
           0x1C: Key("\\", CTRL), 0x1D: Key("]", CTRL), 0x1E: Key("^", CTRL),
           0x1F: Key("_", CTRL), 0x7F: Key("backspace")}
for _byte in range(0x01, 0x1B):
    C0_KEYS.setdefault(_byte, Key(chr(_byte + 0x60), CTRL))


def legacy_char_key(char, mods=0):
    if char.isascii() and char.isupper():
        return Key(char.lower(), mods | SHIFT, shifted=char)
    return Key(char, mods)


class Token:
    """A run of input bytes and the key it encodes, if any."""

    __slots__ = ("raw", "key")

    def __init__(self, raw, key=None):
        self.raw = raw
        self.key = key


UTF8_CHAR = re.compile(
    rb"[\xc0-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf7][\x80-\xbf]{3}")
CSI = re.compile(rb"\x1b\[([\x30-\x3f]*)([\x20-\x2f]*)([\x40-\x7e])")
CSI_PREFIX = re.compile(rb"\x1b\[[\x20-\x3f]*\Z")
PASTE_START, PASTE_END = b"\x1b[200~", b"\x1b[201~"
MAX_PENDING = 1 << 16

TILDE_KEYS = {1: "home", 2: "insert", 3: "delete", 4: "end", 5: "pageup", 6: "pagedown",
              7: "home", 8: "end", 11: "f1", 12: "f2", 13: "f3", 14: "f4", 15: "f5",
              17: "f6", 18: "f7", 19: "f8", 20: "f9", 21: "f10", 23: "f11", 24: "f12"}
LETTER_KEYS = {b"A": "up", b"B": "down", b"C": "right", b"D": "left", b"H": "home",
               b"F": "end", b"P": "f1", b"Q": "f2", b"R": "f3", b"S": "f4"}
KITTY_KEYS = {9: "tab", 13: "enter", 27: "esc", 127: "backspace"}
KITTY_KEYS.update((57376 + n, f"f{13 + n}") for n in range(12))
# Kitty reports modifier keys alone with report-all-keys: shift, ctrl, alt, super...
MODIFIER_KEY_CODES = range(57441, 57453)


def kitty_key(code, mods, kind, shifted):
    if code in MODIFIER_KEY_CODES:
        return Key(MODIFIER_KEY, mods, kind, code=code)
    if code in KITTY_KEYS:
        return Key(KITTY_KEYS[code], mods, kind)
    if code < 0x20 or 0xD800 <= code <= 0xDFFF or code > 0x10FFFF:
        return None
    if 57344 <= code <= 63743:
        return Key(f"key{code}", mods, kind)
    char = chr(code)
    if char.isascii() and char.isupper():
        return Key(char.lower(), mods | SHIFT, kind, shifted=char)
    return Key(char, mods, kind, shifted=shifted)


def _number(text, default):
    return int(text) if text.isdigit() else default


def _field_mods(fields, index):
    """Decode the `mods:kind` field at index. A missing field is a plain press."""
    if len(fields) <= index:
        return 0, PRESS
    mods_text, _, kind_text = fields[index].partition(":")
    return max(_number(mods_text, 1) - 1, 0), _number(kind_text, PRESS)


def csi_key(params, intermediate, final):
    """Decode a CSI key sequence. Return None for anything else."""
    if intermediate or params[:1] in (b"<", b"=", b">", b"?"):
        return None
    try:
        fields = params.decode("ascii").split(";")
    except UnicodeDecodeError:
        return None
    if final == b"u":
        codes = fields[0].split(":")
        if not codes[0].isdigit():
            return None
        mods, kind = _field_mods(fields, 1)
        shifted = None
        if len(codes) > 1 and codes[1].isdigit():
            shifted = chr(int(codes[1]))
        return kitty_key(int(codes[0]), mods, kind, shifted)
    if final == b"~":
        if fields[0] == "27" and len(fields) == 3 and fields[2].isdigit():
            mods, kind = _field_mods(fields, 1)
            return kitty_key(int(fields[2]), mods, kind, None)
        name = TILDE_KEYS.get(_number(fields[0], 0))
        if name is None:
            return None
        mods, kind = _field_mods(fields, 1)
        return Key(name, mods, kind)
    if final == b"Z" and len(fields) == 1:
        return Key("backtab")
    if final in LETTER_KEYS and len(fields) <= 2:
        mods, kind = _field_mods(fields, 1)
        return Key(LETTER_KEYS[final], mods, kind)
    return None


class Tokenizer:
    """Split input bytes into tokens. Keep an unfinished sequence for later."""

    def __init__(self):
        self.pending = b""
        self.in_paste = False

    def feed(self, data):
        data = self.pending + data
        self.pending = b""
        tokens, index = [], 0
        while index < len(data):
            if self.in_paste:
                end = data.find(PASTE_END, index)
                if end < 0:
                    # Keep a possible start of the end marker for the next read.
                    keep = next((n for n in range(len(PASTE_END) - 1, 0, -1)
                                 if data.endswith(PASTE_END[:n])), 0)
                    if len(data) - keep > index:
                        tokens.append(Token(data[index:len(data) - keep]))
                    self.pending = data[len(data) - keep:]
                    return tokens
                tokens.append(Token(data[index:end + len(PASTE_END)]))
                self.in_paste = False
                index = end + len(PASTE_END)
                continue
            token, size = self._next(data, index)
            if token is None:
                self.pending = data[index:]
                if len(self.pending) > MAX_PENDING:
                    tokens.append(Token(self.pending))
                    self.pending = b""
                return tokens
            tokens.append(token)
            index += size
        return tokens

    def flush(self):
        """Return an unfinished sequence as one plain token."""
        pending, self.pending = self.pending, b""
        if pending == b"\x1b":
            return [Token(pending, C0_KEYS[0x1B])]
        return [Token(pending)] if pending else []

    def _next(self, data, index):
        """Return the token at index and its size, or (None, 0) if unfinished."""
        byte = data[index]
        if byte == 0x1B:
            return self._escape(data, index)
        if byte < 0x80:
            key = C0_KEYS.get(byte) or legacy_char_key(chr(byte))
            return Token(data[index:index + 1], key), 1
        match = UTF8_CHAR.match(data, index)
        if match is not None:
            text = match.group()
            return Token(text, legacy_char_key(text.decode())), match.end() - index
        if 0xC0 <= byte <= 0xF7 and len(data) - index < 4 and all(
                0x80 <= b <= 0xBF for b in data[index + 1:]):
            return None, 0
        return Token(data[index:index + 1]), 1

    def _escape(self, data, index):
        if index + 1 == len(data):
            return None, 0
        nxt = data[index + 1:index + 2]
        if nxt == b"[":
            if data.startswith(PASTE_START, index):
                self.in_paste = True
                return Token(PASTE_START), len(PASTE_START)
            if data.startswith(b"\x1b[M", index):
                # X10 mouse: three raw bytes follow.
                if len(data) - index < 6:
                    return None, 0
                return Token(data[index:index + 6]), 6
            match = CSI.match(data, index)
            if match is None:
                if CSI_PREFIX.match(data, index) or PASTE_START.startswith(data[index:]):
                    return None, 0
                return Token(data[index:index + 2]), 2
            key = csi_key(match.group(1), match.group(2), match.group(3))
            return Token(match.group(), key), match.end() - index
        if nxt == b"O":
            if index + 2 == len(data):
                return None, 0
            final = data[index + 2:index + 3]
            key = Key(LETTER_KEYS[final]) if final in LETTER_KEYS else None
            return Token(data[index:index + 3], key), 3
        # OSC, DCS, SOS, PM, and APC strings (terminal replies) end with ST or BEL.
        if nxt in (b"]", b"P", b"X", b"^", b"_"):
            for end in range(index + 2, len(data)):
                if data[end] == 0x07:
                    return Token(data[index:end + 1]), end + 1 - index
                if data[end] == 0x1B and data[end + 1:end + 2] == b"\\":
                    return Token(data[index:end + 2]), end + 2 - index
            return None, 0
        if nxt == b"\x1b":
            return Token(data[index:index + 1], C0_KEYS[0x1B]), 1
        # Legacy Alt: ESC before the key's own bytes.
        token, size = self._next(data, index + 1)
        if token is None:
            return None, 0
        if token.key is None:
            return Token(data[index:index + 1], C0_KEYS[0x1B]), 1
        key = token.key
        alt_key = Key(key.name, key.mods | ALT, shifted=key.shifted)
        return Token(data[index:index + 1 + size], alt_key), 1 + size


PREFIX = "prefix"
# Fixed prefix commands inside a popup.
PREFIX_COMMANDS = ((Combo("q", 0), Action.KILL), (Combo("g", 0), Action.PICKER),
                   (Combo("?", 0), Action.HELP))


def split_prefix(text):
    """Split `key` or `prefix+key`. Return (needs_prefix, key)."""
    text = text.strip()
    head, plus, rest = text.partition("+")
    if plus and head.lower() == PREFIX:
        return True, rest
    return False, text


def parse_binding(text):
    """Parse `key` or `prefix+key`. Return (needs_prefix, combo)."""
    needs_prefix, key = split_prefix(text)
    return needs_prefix, parse_combo(key)


class KeyFilter:
    """Find toggle keys and prefix commands in popup input.

    `prefix` is Herdr's [keys] prefix (a list). `toggle_keys` and `scrollback`
    use Herdr key syntax and can be `prefix+<key>` chords. Empty entries in
    `scrollback` are ignored, as Herdr does.

    `held` is the set of keys (Key.hold) whose press did not go to the
    program. Their repeats and releases do not go to the program either. The
    proxy gives each filter the same set, so that a release after a popup
    page or a popup switch also stays out of the program.

    With `to_program=False` the filter is for a popup page (help, picker):
    popup keys act the same, but no byte goes to the program. take() then
    returns the bytes of the other keys only so that the page can see them,
    and every press is held.
    """

    def __init__(self, prefix, toggle_keys, scrollback=(), held=None, to_program=True):
        self.prefixes = [parse_combo(text) for text in prefix if text.strip()]
        self.direct, self.chords = [], []
        bindings = [(text, Action.HIDE) for text in toggle_keys]
        bindings += [(text, Action.SCROLLBACK) for text in scrollback if text.strip()]
        for text, action in bindings:
            needs_prefix, combo = parse_binding(text)
            (self.chords if needs_prefix else self.direct).append((combo, action))
        self.chords.extend(PREFIX_COMMANDS)
        self.held = set() if held is None else held
        self.to_program = to_program
        # Keys whose press went to the program and that are still down.
        self.down = set()
        # A pressed prefix that waits for its second key: its bytes, its key,
        # and the modifier keys pressed after it.
        self.prefix_raw = None
        self.prefix_hold = None
        self.prefix_modifiers = []

    def _is_prefix(self, key):
        return any(combo.matches(key) for combo in self.prefixes)

    def take(self, tokens):
        """Read tokens from the start of the deque `tokens` up to the first popup key.

        Return (bytes for the program, the popup Action or None). Tokens after
        the popup key stay in the deque for the next reader.
        """
        forward = bytearray()
        while tokens:
            data, action = self._handle(tokens.popleft())
            forward += data
            if action is not None:
                return bytes(forward), action
        return bytes(forward), None

    def _handle(self, token):
        """Decide one token. Return (bytes for the program, popup Action or None)."""
        key = token.key
        if self.prefix_raw is not None and key is not None and (
                key.kind != PRESS or key.name == MODIFIER_KEY):
            if key.kind == RELEASE and key.hold in self.down:
                # The program got the press, so it gets the release now.
                return self._forward(token.raw, key), None
            # The prefix release and lone modifier keys wait with the prefix.
            if key.kind == RELEASE:
                self.held.discard(key.hold)
            elif key.kind == PRESS:
                self.prefix_modifiers.append(key.hold)
            self.prefix_raw += token.raw
            return b"", None
        if key is not None and key.kind != PRESS and key.hold in self.held:
            if key.kind == RELEASE:
                self.held.discard(key.hold)
            return b"", None
        if self.prefix_raw is not None:
            pending, self.prefix_raw = self.prefix_raw, None
            prefix_hold, self.prefix_hold = self.prefix_hold, None
            modifiers, self.prefix_modifiers = self.prefix_modifiers, []
            action = None
            if key is not None:
                action = next((act for combo, act in self.chords if combo.matches(key)), None)
            if action is not None:
                # The program got none of the chord: hold its keys.
                self.held.add(key.hold)
                self.held.update(modifiers)
                return b"", action
            if key is not None and self._is_prefix(key):
                # prefix prefix: one literal prefix press for the program.
                self.held.add(key.hold)
                return pending, None
            if not self.to_program:
                self.held.update(modifiers)
            else:
                # The program gets the prefix press and the modifier presses after
                # it, so it must get their releases too. A release that waited
                # with the prefix is in `pending` already.
                self.down.update(modifiers)
                if prefix_hold in self.held:
                    self.held.discard(prefix_hold)
                    self.down.add(prefix_hold)
            return self._forward(pending + token.raw, key), None
        if key is not None and key.kind == PRESS:
            action = next((act for combo, act in self.direct if combo.matches(key)), None)
            if action is not None:
                self.held.add(key.hold)
                return b"", action
            if self._is_prefix(key):
                self.held.add(key.hold)
                self.prefix_raw = token.raw
                self.prefix_hold = key.hold
                return b"", None
        return self._forward(token.raw, key), None

    def _forward(self, data, key):
        """Bytes for the program. A press that goes to the program ends a hold of its key.

        On a page, nothing goes to the program, so the press is held instead.
        """
        if key is None:
            return data
        if not self.to_program:
            if key.kind == PRESS:
                self.held.add(key.hold)
        elif key.kind == PRESS:
            self.held.discard(key.hold)
            self.down.add(key.hold)
        elif key.kind == RELEASE:
            self.down.discard(key.hold)
        return data
