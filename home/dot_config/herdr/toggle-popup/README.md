# toggle-popup

Herdr plugin `dotfiles.toggle-popup`. It gives persistent popups, like
tmux-toggle-popup. A key shows a program (shell, yazi, lazygit) in a Herdr
popup. The same key hides it again. The program keeps running while the
popup is hidden.

It replaces `home/dot_config/tmux/plugins/toggle-popup.conf`. The design and
its reasons are in `.scratch/herdr-toggle-popup/spec.md`.

## Use

Each popup is one `[[keys.command]] type = "popup"` block in
`home/dot_config/herdr/config.toml`:

```toml
[[keys.command]]
key = "alt+y"
type = "popup"
width = "80%"
height = "80%"
command = 'exec ~/.config/herdr/toggle-popup/toggle.sh --name yazi --toggle-key alt+y -d "$HERDR_ACTIVE_PANE_CWD" -- yazi'
```

`key` opens the popup from a normal pane. `--toggle-key` hides it from
inside. The proxy never reads `key`. `width` and `height` set the popup size.

| Flag | Meaning |
|---|---|
| `--scope tab\|workspace\|pwd\|session` | Where one popup is shared. Default `workspace`. See [Scope](#scope). |
| `--toggle-key <key>` | Hides the popup. Repeat it for more keys. Herdr key syntax; `prefix+f` uses Herdr's `[keys] prefix`. |
| `--name <label>` | Label in the picker and the help header. Default: the command; without a command, the main `default_shell`, else `shell`. Not part of the popup id. |
| `-d <dir>` | Start folder. Used only when the popup is created. |
| `-- <command…>` | The program. Without it, the default shell runs. |

Each toggle saves the current `--name`. A rename in `config.toml` shows on
the next toggle, and the same program continues to run.

The popup border always shows the title `popup`. Herdr 0.9.5 takes it from
the popup terminal's label, and a popup command cannot set that.

## Scope

One key press finds the popup with its **popup id**: 6 hex characters of a
hash of the scope key, the command, and the sorted toggle keys
(`toggle_popup.popup_identity()`). `-d`, `--name`, `width` and `height` do not
change it. If you change the toggle keys of a bind, the next press makes a new
popup.

| Scope | Shared by | Closes when |
|---|---|---|
| `tab` | one tab | the tab or its workspace closes |
| `workspace` | one workspace | the workspace closes |
| `pwd` | panes in one folder, in one Herdr session | the Herdr session is gone |
| `session` | the whole Herdr session | the Herdr session is gone |

Examples, in Herdr session `work`:

- `--scope pwd` from `~/proj/shop` in workspace `api` or `web`: one popup.
  From `~/proj/shop/src`: another popup. A symlink to `~/proj/shop` gives the
  same popup, because the key uses the real path.
- `-d` does not change the scope key. The lazygit bind passes
  `-d "$root"` (the Git root), but `--scope pwd` uses the pane's folder. So
  `~/proj/shop` and `~/proj/shop/src` give 2 lazygit popups, and both start
  at `~/proj/shop`. One popup per repo needs `--scope git`, which is deferred
  (see [Limits](#limits)).
- Moving a tab to another workspace gives it a new tab id, so its `tab`
  popups close.

No popup is shared between Herdr sessions or machines.

## Keys inside a popup

`prefix` is Herdr's `[keys] prefix`.

| Keys | Action |
|---|---|
| a `--toggle-key` | hide the popup |
| `prefix` `q` | kill the popup (close its program) |
| `prefix` `g` | picker: switch to another popup in place |
| `prefix` `?` | help: this popup's keys |
| `prefix` `e` (Herdr's `[keys] edit_scrollback`) | scrollback in `$EDITOR`; no key when `edit_scrollback` is empty |
| `prefix` `prefix` | send one prefix key to the program |
| `prefix` + other key | send both keys to the program |
| `ctrl+b q` | Herdr's built-in viewer detach: hide the popup, like a toggle key. It cannot be turned off. |

If `[keys] prefix` is `ctrl+b` (Herdr's default, for example on a remote
host), the proxy takes `ctrl+b` first: `ctrl+b q` then kills the popup and
its program.

Help page: every key closes help first. Then a toggle key hides the popup,
and `prefix` `q`, `g` or `e` runs its action. Other keys do nothing more.

Picker:

- It lists the popups of this Herdr session only. The first group, named
  after the session, has the `pwd` and `session` popups. Then come the
  workspace groups, in workspace order.
- A row shows the label, the place, and the command. The place is the
  folder for `pwd` and `tab <name>` for `tab`. `*` marks the popup that is
  open now.

  ```text
   work
     └─ * lazygit   ~/proj/shop  lazygit-recent
  ```

- `↑`/`↓`, `ctrl+n`/`ctrl+p`, `j`/`k` move. `Enter` switches. `Esc`, `q`,
  `ctrl+c` cancel. Toggle keys and `prefix` `q`, `?`, `e` also work here.

## Errors

- The toggle script and the proxy show errors as Herdr toasts. Herdr shows
  the popup before Python starts, so on an error the empty popup shows for a
  moment, closes, and then the toast shows. Hooks write only to stderr.
- One popup per Herdr session: while another popup is open (also a
  `navigation` dialog), Herdr refuses the key itself. It shows its own
  "Action rejected" notice with "popup already open".
- A program that cannot start shows a toast, for example
  `cannot run no-such-program: No such file or directory`. A program that
  starts and then exits at once (for example lazygit outside a repo) shows
  "<program> exited at once" when it ends before the toggle checks its pane.
  When it ends later, the popup closes with no toast.
- Python: Herdr runs a popup bind with `/bin/sh -c` and its server's
  `PATH`, which on macOS can find `/usr/bin/python3` (3.9) first. So
  `toggle.sh` runs `/opt/homebrew/bin/python3` when it exists (Homebrew
  points it at its newest Python). Else it runs `python3` from a login shell
  (`/bin/sh -lc`), so `python3` and the popup programs come from the login
  `PATH`, for example `~/.local/bin` on Debian. Without `python3`, the toast
  says "python3 not found".
- Python older than 3.11: each entry point runs itself again with the newest
  `python3.N` (N ≥ 11) on `PATH`. If there is none, the toast says
  "toggle-popup needs Python 3.11+". See `python_guard.py`. It never runs a
  macOS `/usr/bin` shim. The check result is kept in `python-checked.txt`
  (see [Files](#files)), so the slow probe runs only when a Python changes.

## How it works

```text
key press ─► Herdr popup ─► toggle.sh ─► toggle_popup.py (one process)
                              ├─ popup server (Herdr session "toggle-popup")
                              │    └─ one workspace per popup: the backing pane
                              └─ then the key-filter proxy (proxy.py)
                                   └─ herdr terminal attach --takeover <terminal>
```

- **Popup server:** one per machine, for all Herdr sessions. The toggle
  script starts it as `herdr server` with `HERDR_SOCKET_PATH` set to the
  `toggle-popup` session socket. `--session` is not used: it ignores
  `HERDR_SOCKET_PATH`.
- **No plugins in the popup server:** it runs with a private
  `XDG_CONFIG_HOME`, so it has no `plugins.json`. `navigation` and
  `session-titles` never see popup panes. Before each start, the toggle
  deletes a `plugins.json` there, so a stray link never loads again.
- **Program environment:** `launch.py` gives each program the user's real
  `XDG_CONFIG_HOME`, `SHELL` and `HERDR_CONFIG_PATH`. `HERDR_SOCKET_PATH`
  names the Herdr session that owns the popup, and the popup server's
  `HERDR_PANE_ID`, `HERDR_TAB_ID` and `HERDR_WORKSPACE_ID` are removed. So
  `herdr` commands in a popup act on your session, like in a normal pane:
  `chezmoi apply` in a shell popup links the plugin to your session. A popup
  made before this change keeps its old environment until you kill it
  (`prefix` `q`) and toggle it again.
- **Default shell:** the popup server's `default_shell` is the generated
  `popup-shell` script. Each toggle rewrites it with the current
  `[terminal] default_shell` of the main config, so a change applies to the
  next new shell popup without a restart.
- **Key-filter proxy:** while a popup is open, Herdr sends every key into
  it. `proxy.py` finds toggle keys and `prefix` commands in legacy, kitty and
  modifyOtherKeys encodings (`keys.py`). It passes every other byte through.
- **One process:** Herdr's built-in popup runs `toggle_popup.py`. It finds
  or creates the backing pane, then becomes the proxy in the same process.
  So each key press starts Python once, with no `plugin.pane.open` call.
- **Fast attach:** an idle popup server takes a new viewer only on a loop
  pass, up to 250 ms later. So on the viewer's first output, the proxy sends
  one `workspace.list` request that wakes the loop, and does not wait for
  the answer (`proxy.AttachNudge`). A warm show takes about 105 ms from key
  to program text; about 60-80 ms of that is Herdr itself.
- **Two clients:** each attach uses `--takeover`. Clients on the same tab see
  one popup. A takeover by another viewer closes this popup quietly; the
  program keeps running.
- **Cleanup:** the `tab.closed` and `workspace.closed` hooks close owned
  popups (`hooks.py`). Herdr sends no `tab.closed` for the tabs of a closed
  workspace, so `workspace.closed` also closes their `tab` popups. The
  `[[startup]]` hook and each toggle run a sweep for missed events. The
  toggle starts it in a background process once the popup shows its
  program, so it does not slow the popup. A Herdr
  session counts as gone only when its socket is missing or refuses; a
  timeout keeps its popups.

| Module | Job |
|---|---|
| `toggle.sh` | What a bind runs: picks the Python, then runs `toggle_popup.py`. |
| `toggle_popup.py` | Entry point of a key: find or create the popup, then run the proxy. |
| `proxy.py` | The key-filter proxy: viewer, keys, help, picker, scrollback. |
| `keys.py` | Decode key input; find toggle keys and `prefix` chords. |
| `popups.py` | Popup records, scopes, live popups, sweep. |
| `hooks.py` | `tab-closed`, `workspace-closed`, `startup` hooks. |
| `launch.py` | Starts a backing pane's program with the user's environment; reports a failed start. |
| `herdr_api.py` | Socket client, session paths, popup server command, toasts. |
| `herdr_config.py` | Reads `prefix`, `edit_scrollback`, `default_shell` from the main config. |
| `python_guard.py` | Python 3.11+ check of each entry point. |

## Files

All state is under `$XDG_STATE_HOME/herdr/plugins/dotfiles.toggle-popup/`
(default `~/.local/state/herdr/…`):

| Path | Content |
|---|---|
| `popups/<first 32 hex characters of sha256(popup id)>.json` | Popup record: id, scope, label, terminal id, command, toggle keys, owner (session socket, workspace, tab, or folder). |
| `popup-session.toml` | Minimal config of the popup server. |
| `popup-config/` | Private `XDG_CONFIG_HOME` of the popup server. |
| `popup-shell` | Default shell script of the popup server. |
| `popups.lock` | Lock that keeps toggles and hooks from changing records at the same time. |
| `popup-server.json` | Socket identity (device, inode, ctime) of the popup server that the toggle started. |
| `python-checked.txt` | The Python that passed the version check, and the real interpreter it runs, each with its file identity. A change to either file starts a new check. |

The popup server's socket is
`$XDG_CONFIG_HOME/herdr/sessions/toggle-popup/herdr.sock` (default
`~/.config/herdr/…`). To inspect backing panes:
`herdr --session toggle-popup workspace list`.

Do not start the `toggle-popup` session by hand, also when a Herdr error
suggests it. A server started by hand has your real config and plugins.

- The toggle starts the popup server itself only when no server owns the
  socket. It keeps the socket identity in `popup-server.json` only when its
  own child process listens on the socket.
- A server with plugins and with that identity is the plugin's own server
  with a stray link: the toggle and the hooks unlink the plugins and go on,
  with no toast.
- Any other server with plugins is refused. The toast says "the
  toggle-popup Herdr session was not started by toggle-popup; stop it with:
  herdr --session toggle-popup server stop". Run that command, and the next
  toggle starts the popup server again. The stop ends the programs of all
  popups on that machine.

## Install

`chezmoi apply` copies the plugin and runs
`home/.chezmoiscripts/run_onchange_after_herdr-toggle-popup.sh.tmpl`. It
runs `herdr plugin link … --enabled` when a module changes. A remote Herdr
machine needs Python 3.11+ on its login `PATH`, and this folder, the key
lines and the link script, all from chezmoi. Local and remote popups never
mix.

## Tests

`.chezmoiignore` keeps `test/` out of the target. Run from this folder:

| Command | What |
|---|---|
| `test/run-unit.sh [PYTHON]` | Unit tests. Give a Python 3.11+ when `python3` is older, for example `test/run-unit.sh python3.13`. |
| `test/e2e/run-host.sh` | E2E on this Mac, in an isolated Herdr session `tp-e2e`. |
| `test/e2e/docker/run-docker.sh` | E2E in Docker: a client and a remote machine. |
| `uvx ruff check . test test/e2e` | Lint (`ruff.toml`). |
| `test/e2e/bench_toggle.py [RUNS [POLL_MS]]` | Speed: key → popup frame and → program text, cold and warm. Not part of the suite. |

`TOGGLE_POPUP_TRACE=<file>` makes the proxy append event names for the E2E
tests. It never writes typed input.

## Limits

- Pull-out of a popup into a normal pane is deferred: Herdr 0.9.5 cannot move
  a terminal between sessions.
- `--scope git` (one popup per Git root) is deferred.
- If the popup server stops, every popup on that machine ends.
