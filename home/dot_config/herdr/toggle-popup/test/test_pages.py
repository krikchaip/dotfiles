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

    def test_a_filter_leaves_out_the_popup_that_shows(self):
        # Esc goes back to the popup that shows: a filter does not search it.
        self.assertEqual(pages.searched(ROWS, ""), ROWS)
        self.assertEqual(pages.searched(ROWS, "f"), [ROWS[0], ROWS[1], ROWS[3]])
        # The picker bind shows no popup before a choice: a filter searches each row.
        rows = [row._replace(current=False) for row in ROWS]
        self.assertEqual(pages.searched(rows, "f"), rows)


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

    def picker(self, query="", rows=24, cols=120, data=ROWS, cursor=None):
        searched = pages.searched(data, query)
        found = pages.matches(searched, query)
        current = next((n for n, (row, _) in enumerate(found) if row.current), 0)
        return pages.picker_page(rows, cols, query, len(query) if cursor is None else cursor,
                                 found, len(searched), current, pages.picker_columns(data, cols))

    def test_every_color_is_a_theme_token(self):
        tokens = theme(TOKENS)
        allowed = set(tokens.values())
        for name, canvas in (("help", self.help()), ("picker", self.picker()),
                             ("filter", self.picker("lg")), ("no match", self.picker("qqq")),
                             ("kill dialog", pages.kill_dialog(self.picker(), ROWS[0]))):
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
        self.assertEqual(rows[0], "  floating popup" + "7151f9 · prefix ctrl+;".rjust(63))
        self.assertEqual(rows[3:5], ["  Popup", "     ctrl+;   f         hide this popup"])
        self.assertIn("  Program", rows)
        self.assertEqual(rows[-2], "   esc  back to the program")

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
        # The last column: Herdr's scrollbar column after it is the right margin.
        self.assertEqual(canvas.cells[10][119][1:3], ("selection", "panel_bg"))
        self.assertIsNotNone(canvas.cursor)

    def test_matched_letters_show_in_the_accent_color(self):
        canvas = self.picker("lg")
        rows = text_rows(canvas)
        y = next(n for n, row in enumerate(rows) if "lazygit " in row)
        self.assertEqual([canvas.cells[y][x][1] for x in range(5, 12)],
                         ["accent", "text", "text", "text", "accent", "text", "text"])
        self.assertEqual(canvas.cursor, (3, 7))
        self.assertIn("esc  clear", rows[-2])

    def test_the_input_cursor_shows_where_text_goes_in(self):
        self.assertEqual(self.picker("lazy", cursor=1).cursor, (3, 6))
        # A filter longer than the field scrolls, so the cursor stays in the field.
        query = "abcdefghij" * 3
        for cursor in (0, 15, 30):
            with self.subTest(cursor=cursor):
                canvas = self.picker(query, cols=20, cursor=cursor)
                row = text_rows(canvas)[3]
                self.assertLessEqual(canvas.cursor[1], 17)
                self.assertGreaterEqual(canvas.cursor[1], 5)
                # The character at the cursor is the one after the cursor in the filter.
                if cursor < len(query):
                    self.assertEqual(row[canvas.cursor[1]], query[cursor])

    def test_esc_names_what_it_does(self):
        found = pages.matches(ROWS, "")
        for query, closes, label in (("", False, "stay"), ("", True, "close"),
                                     ("x", True, "clear")):
            with self.subTest(query=query, closes=closes):
                canvas = pages.picker_page(24, 120, query, len(query), found, len(ROWS), 0,
                                           pages.picker_columns(ROWS, 120), esc_closes=closes)
                self.assertIn(f"esc  {label}", text_rows(canvas)[-2])

    def test_a_filter_hides_the_popup_that_shows_and_its_group(self):
        rows = text_rows(self.picker("o"))
        # The count leaves it out too: 3 popups to search.
        self.assertTrue(rows[0].endswith(" of 3"), rows[0])
        self.assertFalse(any("floating" in row for row in rows), rows)
        self.assertNotIn("  dotfiles workspace", rows)

    def test_a_filter_that_only_the_popup_that_shows_matches_shows_a_note(self):
        rows = text_rows(self.picker("floating"))
        self.assertTrue(rows[0].endswith("0 of 3"), rows[0])
        self.assertEqual(rows[5], "     No popup matches “floating”")

    def test_no_match_shows_a_note(self):
        rows = text_rows(self.picker("qqq"))
        self.assertTrue(rows[0].endswith("0 of 3"))
        self.assertEqual(rows[5], "     No popup matches “qqq”")
        self.assertIn("esc  clear", rows[-2])

    def test_a_long_list_scrolls_to_the_selected_row(self):
        data = [PickerRow(str(n), f"popup{n}", "nu", "", "group", "workspace", n == 30)
                for n in range(40)]
        rows = text_rows(self.picker(rows=20, data=data))
        self.assertTrue(any("popup30 ●" in row for row in rows))
        self.assertEqual(rows[-3], " " + "─" * 119)

    def test_long_texts_are_cut_and_wide_characters_take_two_cells(self):
        data = [PickerRow("a", "日本語のラベル", "x" * 200, "~/" + "y" * 100, "g", "session",
                          False)]
        canvas = self.picker(cols=60, data=data)
        rows = text_rows(canvas)
        row = next(row for row in rows if "日本" in row)
        self.assertTrue(row.endswith("… ▌"))
        self.assertLessEqual(pages.cells(row), 60)
        self.assertEqual(canvas.cells[6][6][0], "")

    def test_the_margins_count_herdrs_scrollbar_column(self):
        # Herdr draws one more column after the page: the right margin is one
        # column less in the page than the left margin.
        for cols in (79, 80):
            pages_ = (("help", self.help(cols=cols)), ("picker", self.picker(cols=cols)))
            for name, canvas in pages_:
                with self.subTest(page=name, cols=cols):
                    rows = text_rows(canvas)
                    self.assertEqual(rows[1], " " + "─" * (cols - 1))
                    self.assertEqual(len(rows[0]), cols - 1)
                    self.assertTrue(rows[0].startswith("  ") and rows[0][2] != " ")

    def test_the_picker_footer_names_ctrl_d(self):
        self.assertIn("ctrl+d  kill", text_rows(self.picker())[-2])

    def test_control_characters_cannot_reach_the_terminal(self):
        self.assertEqual(pages.visible("a\x1b[2Jb\n"), "a\\x1b[2Jb\\n")


class KillDialog(unittest.TestCase):
    """The ctrl+d confirmation over the picker, as Herdr's close confirmation draws it."""

    def dialog(self, row=ROWS[0], rows=24, cols=120):
        found = pages.matches(ROWS, "")
        backdrop = pages.picker_page(rows, cols, "", 0, found, len(ROWS), 2,
                                     pages.picker_columns(ROWS, cols))
        return pages.kill_dialog(backdrop, row)

    def test_a_box_of_herdrs_size_in_the_middle_names_the_popup(self):
        canvas = self.dialog()
        rows = text_rows(canvas)
        # 64 x 6 cells, in the middle of 120 x 24: columns 28 to 91, rows 9 to 14.
        self.assertEqual(rows[9][28:92], "┌" + "─" * 62 + "┐")
        self.assertEqual(rows[10][28:92], "│ Kill popup?".ljust(63) + "│")
        self.assertEqual(rows[11][28:92],
                         "│ lazygit — lazygit-recent · ~/.local/share/chezmoi".ljust(63) + "│")
        self.assertEqual(rows[12][28:92], "│" + " " * 62 + "│")
        # Two buttons of 13 and 12 cells with a gap of 2, in the middle of the box.
        self.assertEqual(rows[13][28:92], "│" + " " * 17 + "   ↵ kill    " + "  "
                         + " esc cancel " + " " * 18 + "│")
        self.assertEqual(rows[14][28:92], "└" + "─" * 62 + "┘")

    def test_the_dialog_has_the_colors_of_herdrs_confirmation(self):
        canvas = self.dialog()
        self.assertEqual(canvas.cells[9][28][1:], ("red", "panel_bg", False))
        self.assertEqual(canvas.cells[10][30][1:], ("red", "panel_bg", True))
        self.assertEqual(canvas.cells[11][30][1:3], ("text", "panel_bg"))
        self.assertEqual(canvas.cells[13][46][1:], ("contrast", "red", True))
        self.assertEqual(canvas.cells[13][61][1:], ("text", "surface0", True))

    def test_the_picker_behind_the_dialog_is_dim(self):
        canvas = self.dialog()
        self.assertIn((0, 2), canvas.dimmed)
        self.assertIn((13, 10), canvas.dimmed)
        self.assertNotIn((9, 28), canvas.dimmed)
        self.assertNotIn((13, 50), canvas.dimmed)
        output = canvas.render(theme(TOKENS))
        # Each dim cell has SGR 2 after its colors. The dialog cells have none.
        self.assertIn("\x1b[2m", output)
        self.assertNotIn("\x1b[2m┌", output)

    def test_a_popup_without_a_place_names_its_group(self):
        rows = text_rows(self.dialog(ROWS[2]))
        self.assertEqual(rows[11][28:92], "│ floating — nu · dotfiles workspace".ljust(63) + "│")

    def test_a_small_page_gets_a_smaller_box_and_a_cut_detail(self):
        rows = text_rows(self.dialog(rows=10, cols=40))
        # 37 x 6 cells: 4 columns less than the inside of the frame (the page
        # and Herdr's scrollbar column), as in Herdr.
        self.assertEqual(rows[2][2:39], "┌" + "─" * 35 + "┐")
        self.assertTrue(rows[4][2:39].endswith("… │"), rows[4])

    def test_a_long_command_is_cut_before_the_place(self):
        row = ROWS[0]._replace(command="lazygit --work-tree " + "x" * 80)
        rows = text_rows(self.dialog(row))
        self.assertEqual(rows[11][28:92],
                         "│ lazygit — lazygit --work-tree xxxx… · ~/.local/share/chezmoi │")


if __name__ == "__main__":
    unittest.main()
