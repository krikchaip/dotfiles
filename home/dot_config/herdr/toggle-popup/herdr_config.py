"""Read the Herdr settings that the plugin uses.

The plugin checks only the keys that it needs, so a wrong value in another
key does not stop popups.
"""

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

from herdr_api import config_dir

# Herdr's own defaults, used when the config does not set a value.
DEFAULT_PREFIX = ["ctrl+b"]
DEFAULT_SCROLLBACK = ["prefix+e"]


@dataclass
class HerdrConfig:
    """The parts of Herdr's config.toml that change popups."""

    prefix: list[str]
    scrollback: list[str]
    default_shell: str | None


def main_config_path():
    path = os.environ.get("HERDR_CONFIG_PATH")
    return Path(path) if path else config_dir() / "config.toml"


def _read(path):
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    try:
        return tomllib.loads(text)
    except ValueError as error:
        raise ValueError(f"{path}: {error}") from error


def _table(data, name, source):
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ValueError(f"{source}: [{name}] must be a table")
    return value


def _key_list(value, name, default):
    if value is None:
        return list(default)
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    raise ValueError(f"{name} must be a key or a list of keys")


def herdr_config_from(data, source="config.toml"):
    """Check and return the values that the plugin needs from parsed Herdr config."""
    keys = _table(data, "keys", source)
    shell = _table(data, "terminal", source).get("default_shell")
    if shell is not None and not isinstance(shell, str):
        raise ValueError(f"{source}: [terminal] default_shell must be a string")
    prefix = _key_list(keys.get("prefix"), f"{source}: [keys] prefix", DEFAULT_PREFIX)
    scrollback = _key_list(keys.get("edit_scrollback"), f"{source}: [keys] edit_scrollback",
                           DEFAULT_SCROLLBACK)
    return HerdrConfig(prefix=prefix or list(DEFAULT_PREFIX), scrollback=scrollback,
                       default_shell=shell)


def read_main_config(path=None):
    """Read the prefix keys, scrollback keys, and default shell of Herdr's config."""
    path = path or main_config_path()
    return herdr_config_from(_read(path), path)

