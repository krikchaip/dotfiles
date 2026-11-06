# 02: Open the popup with a built-in popup bind and one Python process

Type: task

**Status:** deferred

**Gain:** about 55 ms per toggle (155 → ~101 ms median, warm, key → program text). This is the only option near tmux-toggle-popup (74 ms).

Measured in a throwaway prototype (since deleted). Rebuild it before you change the spec.

## Speed table (warm, key → program text)

| Setup | Median |
|---|---|
| Plugin before the speed work | ~500 ms |
| Plugin now | 155 ms (max ~180) |
| This design (prototype) | 101 ms |
| tmux-toggle-popup | 74 ms |
| Herdr built-in popup | 53 ms |

## What changes

This is a design change. 6 spec parts change:

1. **Declaring popups (Q15):**
   - Now: `type = "shell"`, then the toggle script calls `plugin.pane.open`.
   - After: `type = "popup"` with `width`/`height` in the bind. Herdr opens its built-in popup and runs one Python entry point in it. That entry point finds or creates the backing pane, then becomes the key-filter proxy.
   - The `-w`/`-h` flags go away. The bind's `width`/`height` set the size.
2. **Binds (Q21):** all 3 binds change. Example:
   ```toml
   [[keys.command]]
   key = "alt+y"
   type = "popup"
   width = "80%"
   height = "80%"
   command = 'exec python3 ~/.config/herdr/toggle-popup/popup.py --name yazi --toggle-key alt+y -d "$HERDR_ACTIVE_PANE_CWD" -- yazi'
   ```
3. **One popup at a time:** while another popup is open (for example a `navigation` dialog), Herdr refuses the key itself with "popup already open" (`src/app/popup.rs:52` in Herdr 0.9.5). The "Close the open popup first." toast no longer shows, and the key seems to do nothing.
4. **Errors:** now an error shows only a toast. After: the popup opens first. On an error (for example, a program cannot start), the popup shows for a moment, closes, and then the toast shows.
5. **Manifest:** the `[[panes]]` popup entry and the `TOGGLE_POPUP_PYTHON` launch command go away. The popup border shows the title `popup` at the top left, not the plain `─` rule. Herdr 0.9.5 sets it from the popup terminal's label, or `popup` (`src/server/client_shell.rs:514`). The popup process has no pane ID, so it cannot set the label.
6. **Modules:** `toggle_popup.py` and `proxy.py` join into one entry point.

These stay the same: scopes, the popup server, the picker, help, the hooks, remote machines, and the owner-session env for `herdr` in a popup.

## Background

- Where the 155 ms goes now: 60–80 ms is Herdr (the client connects, probes the host terminal, then sends its hello; the popup server takes the viewer on its next loop pass). The rest is 2 Python starts: the toggle, then the proxy.
- This design saves one Python start and the `plugin.pane.open` round trip.
- The prototype was slow at first (197 ms) because the stage set `PYTHONDONTWRITEBYTECODE=1`. With the bytecode cache: 101 ms.
- Measure with `test/e2e/bench_toggle.py`.

## Exploration 2026-11-05

Prototype: `/tmp/tpbase/one/one.py` (a copy of the plugin plus one entry point). Bench: `/tmp/tpbase/compare.py`, 20 warm shows each, `/usr/bin` first on PATH, bytecode cache on.

| Setup | Warm median | Max |
|---|---|---|
| Plugin now (commit a2db3294) | 157 ms | 173 ms |
| This design, bind runs `python3` | 121 ms | 140 ms |
| This design, bind runs `/opt/homebrew/bin/python3.15` (with issue 01) | 102 ms | 117 ms |

Facts from the Herdr 0.9.5 source:

- A `type = "popup"` command runs with `/bin/sh -c`, not `-lc` (`src/platform/macos.rs:206`). PATH is the Herdr server's PATH.
- The popup env has `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, and `HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID`, `HERDR_ACTIVE_PANE_CWD` (`src/app/custom_commands.rs:243`). Herdr removes the pane identity env (`src/app/popup.rs:139`).
- The popup starts in the active pane's folder (`src/app/popup.rs:133`). The binds keep `-d`: it sets the backing pane's folder, and lazygit needs the Git root.
