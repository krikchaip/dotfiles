"""Resolve Herdr's active theme tokens from Herdr's own source.

Herdr 0.9.5 gives plugins no theme API, environment variable, or color-query
reply. chezmoi fetches the palettes (src/app/state.rs) and theme-name aliases
(src/config/theme.rs) for the installed version; see
.chezmoiexternals/herdr.toml.tmpl. This module applies config.toml `[theme]`
like Herdr's resolve_effective_theme in src/app/mod.rs.

A token is None for Color::Reset, an int for an ANSI color, or an RGB tuple.
"""

import os
from pathlib import Path
import re
import subprocess
import tomllib

SOURCE = Path(__file__).with_name("herdr-src")
# ratatui's named colors, by ANSI index.
NAMED = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "gray",
         "darkgray", "lightred", "lightgreen", "lightyellow", "lightblue",
         "lightmagenta", "lightcyan", "white"]
ALIASES = {"grey": "gray", "darkgrey": "darkgray", "purple": "magenta"}
# Herdr's terminal palette, for tokens a missing or changed source lacks.
FALLBACK = {"panel_bg": None, "surface_dim": 8, "surface0": None, "text": None, "red": 9}


def parse_color(value):
    """Port Herdr's parse_color: hex, #rgb, rgb(), names, and reset aliases."""
    value = value.strip().lower()
    if value in ("reset", "default", "none", "transparent"):
        return None
    if re.fullmatch(r"#[0-9a-f]{6}", value):
        return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
    if re.fullmatch(r"#[0-9a-f]{3}", value):
        return tuple(int(char, 16) * 17 for char in value[1:])
    match = re.fullmatch(r"rgb\((\d+),(\d+),(\d+)\)", value.replace(" ", ""))
    if match and all(int(part) < 256 for part in match.groups()):
        return tuple(map(int, match.groups()))
    value = ALIASES.get(value, value)
    return NAMED.index(value) if value in NAMED else NAMED.index("cyan")


def _source_color(variant, arguments):
    if variant == "Reset":
        return None
    if variant == "Rgb":
        return tuple(int(part) for part in arguments.split(","))
    if variant == "Indexed":
        return int(arguments)
    return NAMED.index(variant.lower())


def _palette(name):
    """Return the built-in palette that Herdr's Palette::from_name gives name."""
    themes = (SOURCE / "theme.rs").read_text()
    states = (SOURCE / "state.rs").read_text()
    canonical = name.lower().replace(" ", "-").replace("_", "-")
    for aliases, target in re.findall(r'((?:"[^"]+"\s*\|?\s*)+)=>\s*Some\("([^"]+)"\)', themes):
        if canonical in re.findall(r'"([^"]+)"', aliases):
            canonical = target
            break
    else:
        return None
    function = re.search(rf'"{re.escape(canonical)}"\s*=>\s*Some\(Self::(\w+)\(\)\)', states)
    body = function and re.search(
        rf"pub fn {function[1]}\(\) -> Self \{{\s*Self \{{(.*?)\n\s*\}}\s*\n\s*\}}", states, re.S)
    if not body:
        return None
    return {token: _source_color(variant, arguments)
            for token, variant, arguments
            in re.findall(r"(\w+):\s*Color::(\w+)(?:\(([^)]*)\))?", body[1])}


def _dark_appearance():
    # Herdr asks the host terminal and assumes dark without a reply; kitty
    # follows the macOS appearance, which this reads without a terminal.
    result = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"],
                            capture_output=True, text=True)
    return result.returncode != 0 or result.stdout.strip() == "Dark"


def tokens():
    path = Path(os.environ.get("HERDR_CONFIG_PATH")
                or Path.home() / ".config/herdr/config.toml")
    try:
        theme = tomllib.loads(path.read_text()).get("theme", {})
    except (OSError, tomllib.TOMLDecodeError):
        theme = {}
    custom = theme.get("custom", {})
    mode = {}
    if theme.get("auto_switch"):
        dark = _dark_appearance()
        name = theme.get("dark_name" if dark else "light_name")
        fallback = "catppuccin" if dark else "catppuccin-latte"
        mode = custom.get("dark" if dark else "light", {})
    else:
        name, fallback = theme.get("name"), "catppuccin"
    try:
        palette = _palette(name or fallback) or _palette(fallback) or {}
    except OSError:
        palette = {}
    result = {**FALLBACK, **palette}
    for overrides in (custom, mode):
        result.update({token: parse_color(value) for token, value in overrides.items()
                       if isinstance(value, str)})
    return result


def sgr(foreground, background, bold=False):
    """Return the SGR sequence ratatui would emit for these tokens."""
    codes = ["0", "1"] if bold else ["0"]
    for color, base in ((foreground, 30), (background, 40)):
        if color is None:
            codes.append(str(base + 9))
        elif isinstance(color, tuple):
            codes.append(f"{base + 8};2;{';'.join(map(str, color))}")
        elif color < 8:
            codes.append(str(base + color))
        elif color < 16:
            codes.append(str(base + 60 + color - 8))
        else:
            codes.append(f"{base + 8};5;{color}")
    return f"\x1b[{';'.join(codes)}m"
