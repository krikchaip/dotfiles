"""The look of the help page and the picker: pages.py."""

import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import herdr_theme
import pages
import proxy
from pages import PickerRow

# A full theme: each token has its own color.
TOKENS = {name: (index, 100, 200) for index, name in enumerate(
    ["accent", "panel_bg", "sidebar_bg", "active_row_bg", "selection_bg", "surface0",
     "surface1", "surface_dim", "overlay0", "overlay1", "text", "subtext0", "mauve", "green",
     "yellow", "red", "blue", "teal", "peach"])}

ROWS = [
    PickerRow("a", "lazygit", "lazygit-recent", "~/.local/share/chezmoi", "default", "session",
              False),
    PickerRow("b", "yazi", "yazi", "~/proj/shop", "default", "session", False),
    PickerRow("c", "floating", "nu", "", "dotfiles", "workspace", True),
    PickerRow("d", "logs", "tail -f log/dev.log", "tab server", "api", "workspace", False),
]


def theme(tokens):
    with mock.patch.object(herdr_theme, "tokens", return_value=dict(tokens)):
        return pages.theme()


def text_rows(canvas):
    return ["".join(cell[0] for cell in row).rstrip() for row in canvas.cells]


def sgr_colors(output):
    """Each foreground and background color of each SGR sequence: ("fg"|"bg", color)."""
    colors = []
    for params in re.findall(r"\x1b\[([0-9;]*)m", output):
        codes = [int(code) for code in params.split(";") if code]
        while codes:
            code = codes.pop(0)
            if code in (38, 48):
                kind = "fg" if code == 38 else "bg"
                if codes[0] == 2:
                    colors.append((kind, tuple(codes[1:4])))
                    del codes[:4]
                else:
                    colors.append((kind, codes[1]))
                    del codes[:2]
            elif code in (39, 49):
                colors.append(("fg" if code == 39 else "bg", None))
            elif 30 <= code <= 37 or 90 <= code <= 97 or 40 <= code <= 47 or 100 <= code <= 107:
                colors.append(("fg" if code % 10 < 8 and code < 40 or 90 <= code <= 97
                               else "bg", code))
    return colors


class Fuzzy(unittest.TestCase):
    def test_the_letters_match_in_order_across_the_fields(self):
        self.assertEqual(pages.fuzzy(ROWS[0], "lg"),
                         {"label": {0, 4}, "command": set(), "place": set(), "group": set()})
        # "y" in the label, then "s" in the place, then "d" in the group.
        self.assertEqual(pages.fuzzy(ROWS[1], "Y SD"),
                         {"label": {0}, "command": set(), "place": {7}, "group": {0}})
        self.assertIsNone(pages.fuzzy(ROWS[1], "qz"))

    def test_an_empty_filter_matches_each_row(self):
        self.assertEqual([row for row, _ in pages.matches(ROWS, "")], ROWS)
        self.assertEqual([row.label for row, _ in pages.matches(ROWS, "dev")], ["logs"])


class Theme(unittest.TestCase):
    def test_the_roles_come_from_the_theme_as_herdr_derives_them(self):
        tokens = theme(TOKENS)
        self.assertEqual(tokens["contrast"], TOKENS["panel_bg"])
        self.assertEqual(tokens["selection"], TOKENS["selection_bg"])
        tokens = theme({**TOKENS, "panel_bg": None, "selection_bg": None})
        self.assertEqual(tokens["contrast"], TOKENS["surface_dim"])
        self.assertEqual(tokens["selection"], TOKENS["active_row_bg"])

    def test_a_failed_theme_read_gives_the_fallback_tokens(self):
        # A herdr-src of another Herdr version can have a color the parser cannot read.
        with mock.patch.object(herdr_theme, "tokens", side_effect=ValueError("Color::Hsl")):
            tokens = pages.theme()
        self.assertEqual(tokens["surface_dim"], herdr_theme.FALLBACK["surface_dim"])
        self.assertIsNone(tokens["selection"])

    def test_a_missing_token_uses_the_default_color(self):
        canvas = pages.Canvas(1, 3)
        canvas.put(0, 0, "x", "accent", "selection")
        output = canvas.render({})
        self.assertIn("\x1b[0;39;49mx", output)


class AutoSwitch(unittest.TestCase):
    DARK, LIGHT = (26, 27, 38), (239, 241, 245)

    def panel_bg(self, **run):
        """panel_bg with auto_switch on, when `defaults` gives run (a mock.patch argument)."""
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "config.toml"
            config.write_text('[theme]\nauto_switch = true\n'
                              'dark_name = "tokyo-night"\nlight_name = "catppuccin-latte"\n')
            palettes = {"tokyo-night": {"panel_bg": self.DARK},
                        "catppuccin-latte": {"panel_bg": self.LIGHT}}
            with (mock.patch.dict(os.environ, {"HERDR_CONFIG_PATH": str(config)}),
                  mock.patch.object(herdr_theme.subprocess, "run", **run),
                  mock.patch.object(herdr_theme, "_palette", side_effect=palettes.get)):
                return herdr_theme.tokens()["panel_bg"]

    def test_without_defaults_the_dark_theme_is_used(self):
        # Linux has no `defaults`. Herdr assumes dark when the terminal gives no reply.
        self.assertEqual(self.panel_bg(side_effect=FileNotFoundError("defaults")), self.DARK)

    def test_macos_dark_mode_uses_the_dark_theme(self):
        dark = mock.Mock(returncode=0, stdout="Dark\n")
        self.assertEqual(self.panel_bg(return_value=dark), self.DARK)

    def test_macos_light_mode_uses_the_light_theme(self):
        # Light mode has no AppleInterfaceStyle: `defaults read` fails.
        light = mock.Mock(returncode=1, stdout="")
        self.assertEqual(self.panel_bg(return_value=light), self.LIGHT)


class Pages(unittest.TestCase):
    def help(self, rows=24, cols=80):
        keys = proxy.help_rows(["ctrl+;"], ["prefix+f"], ["prefix+e"])
        return pages.help_page(rows, cols, "floating popup", "7151f9 · prefix ctrl+;", keys)

    def picker(self, query="", rows=24, cols=120, data=ROWS):
        found = pages.matches(data, query)
        current = next((n for n, (row, _) in enumerate(found) if row.current and not query), 0)
        return pages.picker_page(rows, cols, query, found, len(data), current,
                                 pages.picker_columns(data, cols))

    def test_every_color_is_a_theme_token(self):
        tokens = theme(TOKENS)
        allowed = set(tokens.values())
        for name, canvas in (("help", self.help()), ("picker", self.picker()),
                             ("filter", self.picker("lg")), ("no match", self.picker("qqq"))):
            with self.subTest(page=name):
                colors = {color for _, color in sgr_colors(canvas.render(tokens))}
                self.assertTrue(colors)
                self.assertLessEqual(colors, allowed)

    def test_no_text_shows_in_reverse_video(self):
        output = self.picker().render(theme(TOKENS))
        for params in re.findall(r"\x1b\[([0-9;]*)m", output):
            self.assertNotIn("7", re.sub(r"(38|48);2;\d+;\d+;\d+|(38|48);5;\d+", "", params)
                             .split(";"))

    def test_the_help_page_lists_the_keys_in_sections(self):
        rows = text_rows(self.help())
        self.assertEqual(rows[0], "  floating popup" + "7151f9 · prefix ctrl+;".rjust(62))
        self.assertEqual(rows[3:5], ["  Popup", "     ctrl+;   f         hide this popup"])
        self.assertIn("  Program", rows)
        self.assertEqual(rows[-2], "   any key  back to the program")

    def test_the_picker_marks_the_selected_row_and_the_current_popup(self):
        canvas = self.picker()
        rows = text_rows(canvas)
        self.assertTrue(rows[0].endswith("4 of 4"))
        self.assertEqual(rows[3], "   › Filter popups")
        self.assertEqual(rows[5], "  default session")
        self.assertEqual(rows[10].rstrip("▌").rstrip(), " │ › floating ●" + " " * 31 + "nu")
        self.assertTrue(rows[10].endswith("▌"))
        self.assertEqual(canvas.cells[10][5][1:], ("text", "selection", True))
        self.assertEqual(canvas.cells[10][14][1], "green")
        self.assertEqual(canvas.cells[10][118][1:3], ("selection", "panel_bg"))
        self.assertIsNotNone(canvas.cursor)

    def test_matched_letters_show_in_the_accent_color(self):
        canvas = self.picker("lg")
        rows = text_rows(canvas)
        y = next(n for n, row in enumerate(rows) if "lazygit " in row)
        self.assertEqual([canvas.cells[y][x][1] for x in range(5, 12)],
                         ["accent", "text", "text", "text", "accent", "text", "text"])
        self.assertEqual(canvas.cursor, (3, 7))
        self.assertIn("esc  clear", rows[-2])

    def test_no_match_shows_a_note(self):
        rows = text_rows(self.picker("qqq"))
        self.assertTrue(rows[0].endswith("0 of 4"))
        self.assertEqual(rows[5], "     No popup matches “qqq”")
        self.assertIn("esc  clear", rows[-2])

    def test_a_long_list_scrolls_to_the_selected_row(self):
        data = [PickerRow(str(n), f"popup{n}", "nu", "", "group", "workspace", n == 30)
                for n in range(40)]
        rows = text_rows(self.picker(rows=20, data=data))
        self.assertTrue(any("popup30 ●" in row for row in rows))
        self.assertEqual(rows[-3], "─" * 120)

    def test_long_texts_are_cut_and_wide_characters_take_two_cells(self):
        data = [PickerRow("a", "日本語のラベル", "x" * 200, "~/" + "y" * 100, "g", "session",
                          False)]
        canvas = self.picker(cols=60, data=data)
        rows = text_rows(canvas)
        row = next(row for row in rows if "日本" in row)
        self.assertTrue(row.endswith("… ▌"))
        self.assertLessEqual(pages.cells(row), 59)
        self.assertEqual(canvas.cells[6][6][0], "")

    def test_control_characters_cannot_reach_the_terminal(self):
        self.assertEqual(pages.visible("a\x1b[2Jb\n"), "a\\x1b[2Jb\\n")


if __name__ == "__main__":
    unittest.main()
