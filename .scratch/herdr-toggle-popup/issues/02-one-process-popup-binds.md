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
5. **Manifest:** the `[[panes]]` popup entry and the `TOGGLE_POPUP_PYTHON` launch command go away. The popup title is what Herdr shows for a built-in popup, not the plain `─` rule. Not checked yet.
6. **Modules:** `toggle_popup.py` and `proxy.py` join into one entry point.

These stay the same: scopes, the popup server, the picker, help, the hooks, remote machines, and the owner-session env for `herdr` in a popup.

## Background

- Where the 155 ms goes now: 60–80 ms is Herdr (the client connects, probes the host terminal, then sends its hello; the popup server takes the viewer on its next loop pass). The rest is 2 Python starts: the toggle, then the proxy.
- This design saves one Python start and the `plugin.pane.open` round trip.
- The prototype was slow at first (197 ms) because the stage set `PYTHONDONTWRITEBYTECODE=1`. With the bytecode cache: 101 ms.
- Measure with `test/e2e/bench_toggle.py`.
