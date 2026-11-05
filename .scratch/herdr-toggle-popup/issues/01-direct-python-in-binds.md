# 01: Run the newest Python directly in the toggle binds

Type: task

**Status:** deferred

**Gain:** about 10 ms per toggle (155 → ~145 ms median, warm, key → program text).

## What changes

The design stays the same. 2 spec parts change:

1. **Runtime (Q10):** the binds start the newest Python 3.11+ directly. A key press no longer starts `/usr/bin/python3` (3.9) first. The version check in `python_guard.py` stays as a fallback.
2. **Planned binds (Q21):** the bind commands start with the found Python, not `python3`. `home/dot_config/herdr/config.toml` becomes `config.toml.tmpl`, and chezmoi finds the Python at `chezmoi apply` time:
   ```toml
   command = '{{ .python }} ~/.config/herdr/toggle-popup/toggle_popup.py --name yazi --toggle-key alt+y …'
   ```

## Why it is deferred

- The gain is small.
- Risk: after `brew upgrade python`, the old path can go away. The keys then break until the next `chezmoi apply`.

## Background

- Shell keys run through `/bin/sh -lc`. On macOS, `path_helper` puts `/usr/bin/python3` first in `PATH`.
- The check result is kept in `~/.local/state/herdr/plugins/dotfiles.toggle-popup/python-checked.txt` (see the README, "Errors").
- Measure with `test/e2e/bench_toggle.py`. Remove `PYTHONDONTWRITEBYTECODE` from the stage env first, or the numbers do not model live use.
