"""The look of the proxy's pages: the help page (prefix ?) and the picker (prefix g).

The pages use look A of the prototype: a bold title with a dim origin on the
right and a rule under them, and a footer with key chips. The picker has a
filter field, and its selected row looks like the rows of navigation's
dialogs (navigation/move_ui.py).

Each cell has a Herdr theme token for its foreground and its background.
herdr_theme reads the active theme. The roles "contrast" and "selection"
come from the theme as Herdr derives them. A token that the theme does not
give, for example when herdr-src is missing, uses the default color of the
terminal. No color is hard-coded, and no text shows in reverse video.

proxy.py imports this module only when a page opens: a toggle key must
start fast.
"""

import typing
import unicodedata

import herdr_theme

# The fields of a picker row that the filter reads, in match order.
FIELDS = ("label", "command", "place", "group")
# The columns of the picker rows, as in the prototype: the minimums.
PLACE_X = 20
COMMAND_X = 46
# The column of the help texts: the minimum.
HELP_TEXT_X = 24


def theme():
    """The theme tokens and the derived roles. A token is None for the default color.

    The theme read must not stop a page. For example, a herdr-src of another
    Herdr version can have a color that herdr_theme cannot parse.
    """
    try:
        tokens = herdr_theme.tokens()
    except ValueError:
        tokens = dict(herdr_theme.FALLBACK)
    # Herdr's contrast(): text on accent fills uses the panel color.
    panel = tokens.get("panel_bg")
    tokens["contrast"] = panel if panel is not None else tokens.get("surface_dim")
    # Herdr's sidebar cursor: selection_bg, or active_row_bg when it is Reset.
    selection = tokens.get("selection_bg")
    tokens["selection"] = selection if selection is not None else tokens.get("active_row_bg")
    return tokens


def visible(text):
    """Text that cannot become a terminal command: show control characters as escapes."""
    return "".join(char if char.isprintable() else ascii(char)[1:-1] for char in str(text))


def char_cells(char):
    if unicodedata.combining(char):
        return 0
    return 2 if unicodedata.east_asian_width(char) in "WF" else 1


def cells(text):
    """The width of text in terminal cells."""
    return sum(char_cells(char) for char in text)


def fit(text, width):
    """Cut text to `width` cells. A cut ends with an ellipsis."""
    if width <= 0:
        return ""
    if cells(text) <= width:
        return text
    out, used = [], 0
    for char in text:
        size = char_cells(char)
        if used + size > width - 1:
            break
        out.append(char)
        used += size
    return "".join(out) + "…"


class Canvas:
    """A grid of cells. Each cell has a character, a foreground token, a background token,
    and bold. The second cell of a wide character has the character ""."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        blank = (" ", "text", "panel_bg", False)
        self.cells = [[blank] * cols for _ in range(rows)]
        # The (row, column) of the terminal cursor, or None to hide it.
        self.cursor = None

    def _set(self, y, x, cell):
        row = self.cells[y]
        # Do not leave half of a wide character.
        if row[x][0] == "" and x > 0:
            row[x - 1] = (" ", *row[x - 1][1:])
        if x + 1 < self.cols and row[x + 1][0] == "" and cell[0] != "":
            row[x + 1] = (" ", *row[x + 1][1:])
        row[x] = cell

    def put(self, y, x, text, fg="text", bg="panel_bg", bold=False, hits=(), hit_fg="accent"):
        """Write text at row y from column x. Return the column after it.

        The characters at the indexes in `hits` show in `hit_fg`, in bold.
        Text outside the canvas is cut.
        """
        for index, char in enumerate(text):
            size = char_cells(char)
            if size == 0:
                continue
            if 0 <= y < self.rows and 0 <= x and x + size <= self.cols:
                hit = index in hits
                style = (hit_fg if hit else fg, bg, bold or hit)
                self._set(y, x, (char, *style))
                if size == 2:
                    self._set(y, x + 1, ("", *style))
            x += size
        return x

    def fill(self, y, x, width, bg):
        self.put(y, x, " " * max(0, width), bg=bg)

    def render(self, tokens):
        """The terminal output of the canvas, with the colors of the theme `tokens`."""
        out = []
        for y, row in enumerate(self.cells):
            out.append(f"\x1b[{y + 1};1H")
            last = None
            for char, fg, bg, bold in row:
                if char == "":
                    continue
                if (fg, bg, bold) != last:
                    out.append(herdr_theme.sgr(tokens.get(fg), tokens.get(bg), bold))
                    last = (fg, bg, bold)
                out.append(char)
        out.append("\x1b[0m")
        if self.cursor is not None:
            out.append(f"\x1b[{self.cursor[0] + 1};{self.cursor[1] + 1}H\x1b[?25h")
        else:
            out.append("\x1b[?25l")
        return "".join(out)


def chip(canvas, y, x, text, fg="text", bg="surface0"):
    """A key cap: bold text on a filled background, with one space at each side."""
    return canvas.put(y, x, f" {text} ", fg, bg, True)


def header_footer(canvas, title, origin, hints):
    """The title and its origin, the rules, and the key hints of the footer."""
    cols, bottom = canvas.cols, canvas.rows
    origin = fit(origin, cols // 2)
    canvas.put(0, 2, fit(title, cols - cells(origin) - 6), bold=True)
    canvas.put(0, cols - 2 - cells(origin), origin, "overlay0")
    canvas.put(1, 0, "─" * cols, "surface1")
    canvas.put(bottom - 3, 0, "─" * cols, "surface1")
    x = 2
    for key, text in hints:
        if x + cells(f" {key}  {text}") > cols - 2:
            break
        x = chip(canvas, bottom - 2, x, key)
        x = canvas.put(bottom - 2, x, f" {text}   ", "overlay1")


def help_page(rows, cols, title, origin, keys):
    """The help page. `keys` are (section, [key chips], text) rows."""
    canvas = Canvas(rows, cols)
    header_footer(canvas, title, origin, [("any key", "back to the program")])
    text_x = max([HELP_TEXT_X] + [4 + sum(cells(key) + 3 for key in chips) + 2
                                  for _, chips, _ in keys])
    last = rows - 4
    y = 3
    for section in dict.fromkeys(section for section, _, _ in keys):
        if y > last:
            break
        canvas.put(y, 2, section, "accent", bold=True)
        y += 1
        for name, chips, text in keys:
            if name != section or y > last:
                continue
            x = 4
            for key in chips:
                x = chip(canvas, y, x, key, "accent") + 1
            canvas.put(y, text_x, fit(text, cols - text_x - 2))
            y += 1
        y += 1
    return canvas


class PickerRow(typing.NamedTuple):
    """One popup in the picker. The texts are visible() already."""

    popup_id: str
    label: str
    command: str
    place: str  # The tab or the folder that shares the popup, or "".
    group: str
    kind: str  # The kind of the group: "session" or "workspace".
    current: bool  # The popup that shows.


def fuzzy(row, query):
    """Match the letters of `query` in order, as fzf does, across the FIELDS of `row`.

    Case and spaces do not count. Return {field: set of matched indexes},
    or None when the row does not match.
    """
    letters = query.lower().replace(" ", "")
    hits = {field: set() for field in FIELDS}
    at = 0
    for field in FIELDS:
        for index, char in enumerate(getattr(row, field).lower()):
            if at < len(letters) and char == letters[at]:
                hits[field].add(index)
                at += 1
    return hits if at == len(letters) else None


def matches(rows, query):
    """The rows that match `query`: [(row, hits)], in the order of `rows`."""
    found = []
    for row in rows:
        hits = fuzzy(row, query)
        if hits is not None:
            found.append((row, hits))
    return found


def picker_columns(rows, cols):
    """The columns of the place and the command, the same for each filter."""
    label_width = max(cells(row.label) + (2 if row.current else 0) for row in rows)
    place_width = max(cells(row.place) for row in rows)
    place_x = min(max(PLACE_X, 5 + label_width + 3), cols // 3)
    command_x = max(COMMAND_X, place_x + place_width + 3) if place_width else place_x
    return place_x, min(command_x, 2 * cols // 3)


def picker_page(rows, cols, query, found, total, selected, columns):
    """The picker. `found` are the (row, hits) that match `query`, of `total`
    popups. `selected` is the index of the selected row in `found`."""
    canvas = Canvas(rows, cols)
    hints = [("↑↓", "move"), ("enter", "show"), ("esc", "clear" if query else "stay")]
    header_footer(canvas, "Switch popup", f"{len(found)} of {total}", hints)
    # A filled input, as navigation's _input draws it.
    canvas.fill(3, 1, cols - 2, "surface0")
    canvas.put(3, 3, "›", "accent", "surface0", True)
    room = max(1, cols - 8)
    shown = query
    while cells(shown) > room:
        shown = shown[1:]
    canvas.put(3, 5, shown or "Filter popups", "text" if query else "overlay0", "surface0")
    canvas.cursor = (3, min(5 + cells(shown), cols - 1))
    if not found:
        x = canvas.put(5, 5, "No popup matches ", "overlay1")
        canvas.put(5, x, fit(f"“{query}”", cols - x - 2), "text", bold=True)
        return canvas
    # The lines of the list: group titles, rows, and a gap after each group.
    lines = []
    for index, (row, hits) in enumerate(found):
        if index == 0 or found[index - 1][0].group != row.group:
            if index:
                lines.append(None)
            lines.append(row)
        lines.append((index, row, hits))
    top, height = 5, max(1, rows - 8)
    at = next(n for n, line in enumerate(lines)
              if isinstance(line, tuple) and line[0] == selected)
    start = max(0, min(at - height // 2, len(lines) - height))
    place_x, command_x = columns
    for y, line in enumerate(lines[start:start + height], top):
        if line is None:
            continue
        if isinstance(line, PickerRow):
            canvas.put(y, 2, line.group, "overlay1", bold=True)
            canvas.put(y, 3 + cells(line.group), line.kind, "overlay0")
            continue
        index, row, hits = line
        active = index == selected
        bg = "selection" if active else "panel_bg"
        if active:
            canvas.fill(y, 1, cols - 2, bg)
            canvas.put(y, 1, "│", "accent", bg)
            canvas.put(y, cols - 2, "▌", "selection", "panel_bg")
            canvas.put(y, 3, "›", "accent", bg)
        label_room = place_x - 5 - (4 if row.current else 2)
        end = canvas.put(y, 5, fit(row.label, label_room), "text", bg, active, hits["label"])
        if row.current:
            canvas.put(y, end + 1, "●", "green", bg)
        canvas.put(y, place_x, fit(row.place, command_x - place_x - 2), "overlay1", bg,
                   hits=hits["place"])
        canvas.put(y, command_x, fit(row.command, cols - 3 - command_x), "overlay0", bg,
                   hits=hits["command"])
    return canvas
