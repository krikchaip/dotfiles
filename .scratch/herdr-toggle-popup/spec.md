# Herdr toggle-popup plugin

`dotfiles.toggle-popup` is a local Herdr plugin. It replaces the tmux setup in `home/dot_config/tmux/plugins/toggle-popup.conf`. It follows tmux-toggle-popup's behavior. Each popup is a named, persistent program, such as a shell, yazi, or lazygit. It runs in a private Herdr session called `toggle-popup`, and a `terminal attach` viewer shows it inside a Herdr popup. A key-filter proxy written in Python (standard library only) wraps that viewer. The proxy catches each popup's own toggle keys and a small `prefix` command set: kill, popup picker, help, and scrollback in an editor. Pull-out into a normal pane or tab is on hold: Herdr 0.9.5 cannot move a terminal between sessions. The plugin also has to work on remote Herdr machines. Docker containers and an isolated session on the Mac host give it end-to-end tests. The first build step is a prototype of the proxy's key detection. It must handle legacy and kitty-style key encodings.

## Terms

- **Popup**: a Herdr session-modal floating terminal. Herdr allows one per Herdr session, and it always starts a new process. _Avoid_: float, scratchpad, overlay.
- **Backing pane**: the pane in the popup session that runs a popup's program and keeps it alive while the popup is hidden. _Avoid_: hidden terminal, scratchpad.
- **Popup session**: the private Herdr named session (`toggle-popup`) that holds every backing pane, like tmux-toggle-popup's separate popup tmux server. _Avoid_: backing session, scratch session.
- **Viewer**: the short-lived `herdr --session toggle-popup terminal attach <terminal_id>` process inside the popup that shows a backing pane. _Avoid_: client, mirror.
- **Key-filter proxy**: the Python program inside each popup. It runs the viewer, acts on toggle keys and `prefix` commands, and passes every other key through. _Avoid_: wrapper, interceptor.
- **Toggle key**: a key or `prefix+key` chord that hides a popup from inside it. Each popup sets its own with `--toggle-key`, and it may be the same as or different from the outer key that opens the popup. _Avoid_: hotkey, detach key.
- **Popup id**: the identity of one popup: the first 6 hex characters of a hash of its scope key, its command, and its sorted `--toggle-key` flags (for example `a3f9c2`). The plugin maps it to the backing pane. _Avoid_: popup name, pane id.
- **Scope**: where one popup is shared: `tab`, `workspace` (default), `pwd` (panes with the same current folder in one Herdr session), or `session`. No popup is shared between Herdr sessions. _Avoid_: id format.
- **Label**: the optional `--name`, shown in the picker and the help header. It defaults to the command and is not part of the identity. _Avoid_: popup id.
- **Pull-out**: moving a popup's backing pane into a normal split or tab, so that it stops being a popup. _Avoid_: embed, break-pane, pop-in.
- **Plugin list**: the `package.herdr` list in `home/.chezmoidata/package.yaml`, which chezmoi installs from GitHub. _Avoid_: plugin manifest, lockfile.
- **Herdr session**: a named Herdr server with its own socket (`herdr --session <name>`). Its tmux equivalent is a tmux server (`tmux -L <socket>`), not a tmux session. A Herdr workspace is like a tmux session, and a Herdr tab is like a tmux window. _Avoid_: tmux session, "main session" without a qualifier.

## Why

The user's words: "I want to install this herdr plugin [herdr-scratch] to serve as an alternative to `home/dot_config/tmux/plugins/toggle-popup.conf`. I used tmux before and just moved to herdr not so long ago." While the user read herdr-scratch, they decided that the features they need are outside its scope. They chose to write their own plugin, "inspired by the herdr-scratch plugin and tmux-toggle-popup", with these requirements:

- No external dependencies. Like herdr-scratch and tmux-toggle-popup, it keeps popups in a separate session that exists only for popups.
- An arbitrary toggle key for each command, like tmux-toggle-popup.
- A menu or key that pulls a popup into a normal pane in the same tab, or into a new tab. This is like tmux-floax; neither reference plugin has it. It is now on hold (see Deferred).
- Feature parity with herdr-scratch and tmux-toggle-popup comes later, feature by feature. "Mainly, I'll stick to the behavior of tmux-toggle-popup."
- Separately: "I want my herdr plugin list to stay with me", tracked like `home/.chezmoidata/package.yaml`, because Herdr has no dependency file for plugins. This is deferred until the plugin works (Q9).

The tmux behavior being replaced (`toggle-popup.conf`):

| tmux bind | Popup | Identity | Toggle keys inside |
|---|---|---|---|
| `prefix f` / `prefix C-f` | floating shell, opened at `pane_current_path` | `--name=floating`, one per tmux session | `C-z` |
| `M-y` | yazi at `$PWD` | `--name=yazi_pwd` | `C-z`, `M-y` |
| `M-g` | `lazygit-recent` at the Git root of `$PWD` | `--id="lazygit$root"`, shared by all sessions | `M-g` |
| `prefix c` | pi quick chat | `--id=pi_popup` | `C-z`, `C-d` |

Pi quick chat is out of scope.

## Locked decisions

### Popup programs live in a private popup session (Q13)

| Option | User experience | Technical correctness | Risk | Recurring cost |
|---|---|---|---|---|
| A. A visible "popups" workspace in the main Herdr session. Pull-out is a real `pane.move` | mixed | good | mixed | good |
| **B. A private Herdr session, like tmux-toggle-popup and herdr-scratch** | **good** | **poor** | **mixed** | **mixed** |

**Decision: B.** Backing panes live in a private Herdr session named `toggle-popup`. The user wanted B together with A's pane behavior. If both were not possible, pull-out would be put on hold. Both are not possible in Herdr 0.9.5 (see Verified facts), so pull-out is deferred.

- **Why A lost:** it puts an extra workspace in the sidebar. Opening that workspace while a popup shows the same pane makes the two views fight over the terminal size. Closing that workspace by hand ends every popup. A was the recommendation because it is the only option where pull-out gives a real pane. The user ranked invisibility and tmux parity higher.
- **What B gives up:** technical correctness is poor only for pull-out. A popup can never become a real pane that Herdr tracks (cwd, agent detection, tab bar). Cost is mixed because B runs one extra Herdr server process.

### A key-filter proxy gives each popup its own toggle keys (Q14)

| Option | User experience | Technical correctness | Risk | Recurring cost |
|---|---|---|---|---|
| **A. Key-filter proxy between the user and the viewer** | **good** | **mixed** | **mixed** | **good** |
| B. A nested full Herdr client per popup, with its own `HERDR_CONFIG_PATH` where `detach` = the toggle key | mixed | mixed | poor | poor |
| C. Key bindings inside each app (nu, yazi, lazygit) that call a hide helper | mixed | poor | good | good |

**Decision: A.** While a popup is open, Herdr sends every key into it, so no Herdr keybinding can fire. The popup's own process has to catch the toggle key. The proxy works for any key and any program, with no setup per app. The same proxy also catches the `prefix` commands (Q22).

- **Weakest axes, correctness and risk:** Herdr can deliver keys as legacy bytes or as kitty keyboard protocol sequences, and a decode bug could swallow a key or let it through. A prototype must settle this first (see Risks).
- **Why B lost:** it needs one Herdr server for each popup and the experimental nested-client guard, and it has to hide the nested sidebar and tab bar.
- **Why C lost:** it needs setup in every app, and it fails while the app runs a child process.

### Inside a popup, the prefix runs a small popup command set (Q22)

| Option | User experience | Technical correctness | Risk | Recurring cost |
|---|---|---|---|---|
| **A. A small command set in the proxy; each popup stays one terminal** | **mixed** | **good** | **good** | **good** |
| B. Each popup is a workspace shown by a nested full Herdr client (chrome hidden), so all Herdr keys work inside, like tmux | good | mixed | mixed | mixed |

**Decision: A**, with these commands:

| Keys inside a popup | Action |
|---|---|
| any `--toggle-key`, including a `prefix+key` chord such as `prefix+f` | hide the popup (the program keeps running) |
| `prefix` `q` | kill the popup: close its backing pane |
| `prefix` `g` | popup picker: switch this popup to another popup in place |
| `prefix` `?` | help: list this popup's keys |
| `prefix` `e` (from Herdr's `[keys] edit_scrollback`) | scrollback in `$EDITOR` (Q23) |
| `prefix` `prefix` | send one literal prefix key (`ctrl+;`) to the program |
| `prefix` + any other key | forward both keys to the program unchanged |

While the help page is open, every key first closes help. A toggle key then hides the popup, and `prefix` `q`, `g`, or `e` then runs its action. `prefix` `?` only closes help. Any other key only closes help and is not sent to the program.

The proxy reads the prefix from Herdr's `[keys] prefix` (yours is `ctrl+;`). Do not add `prefix+ctrl+<key>` binds (the user said so in Q21). There is no restart command; to restart, kill with `prefix` `q` and press the outer key again.

The outer key and the toggle keys are independent. The `key` in `[[keys.command]]` opens the popup from a normal pane, and the `--toggle-key` flags close it from inside. They can be the same (`prefix+f` both ways) or different (`alt+g` opens, `ctrl+z` closes), and a popup with no `--toggle-key` closes only through `prefix` `q`, the program exiting, or the viewer's `ctrl+b q`. The proxy never reads the outer `key`; only the flags count.

- **What A gives up:** user experience is mixed. It is a second, small set of keys. A popup has no tabs or splits, and it has no Herdr copy mode. Q23 adds scrollback in an editor instead.
- **Why B lost:** B was the recommendation, because it matches what "manage the popup session" meant in tmux. But it has open problems:
  - The nested client switches to another popup's workspace when a popup's last pane exits.
  - Opening a client focused on one workspace has not been tested.
  - Every open starts a full client, with one more layer for kitty graphics.
  - It depends on `[experimental] allow_nested`.

## Routine choices

- **Plugin list format (Q1): pinned entries.** Use `OWNER/REPO@vX.Y.Z`, which the installer turns into `herdr plugin install OWNER/REPO --ref vX.Y.Z`. Each machine gets the same version, and changing the tag reruns the `run_onchange` script. Unpinned installs break when the branch changes `VERSION` before the release binaries exist. Applies when the installer is built (Q9).
- **Plugin list sync (Q2): add only.** The installer installs missing plugins and changes the ref of pinned plugins. To uninstall, run `herdr plugin uninstall <id>` by hand. This is the same as the Brewfile, mise, and yazi lists.
- **Which popups (Q3):** the floating shell, yazi, and lazygit. All three are persistent, and lazygit and yazi behave as close to tmux as possible. Pi quick chat is out.
- **Floating shell scope (Q4): one per Herdr workspace.** This is the same as tmux's one per tmux session.
- **Location (Q8): local plugin in dotfiles.** It goes in `home/dot_config/herdr/toggle-popup/` with plugin id `dotfiles.toggle-popup`. A `run_onchange_after_herdr-toggle-popup.sh.tmpl` script runs `herdr plugin link … --enabled`, like `navigation`. It moves to its own repo when it is stable.
- **Runtime (Q10, changed after the build: speed): Python 3.11+ standard library only** (`tomllib` reads `config.toml`). Herdr runs popup keys through `/bin/sh -c` with the PATH of the Herdr server, and on macOS that PATH can find `/usr/bin/python3` (3.9) first. So each bind runs `toggle.sh`, which starts `/opt/homebrew/bin/python3` when that file is executable, else `python3` from a login shell (`/bin/sh -lc`), so `python3` and the popup programs come from the login PATH, as with shell binds. Without `python3`, `toggle.sh` shows a toast. Homebrew moves that link to its newest Python on each upgrade, so the bind never names a Python version. On a Python older than 3.11, each entry point runs itself again with the newest `python3.N` (N ≥ 11) on PATH that imports `tomllib`, and it never runs a macOS `/usr/bin` shim. If there is none, a toggle or popup shows one toast, "toggle-popup needs Python 3.11+ (found X.Y)", and a hook writes only to stderr. Modules used: (`socket`, `json`, `pty`, `termios`, `tty`, `fcntl`, `select`, `subprocess`), like `navigation` and `session-titles`. `herdr api` cannot send raw JSON, and some methods exist only on the socket (`popup.close`, `pane.focus <id>`). So the plugin uses a small socket client: one JSON line per request, one response line.
- **Pull-out targets (Q11): split right, split down, new tab beside the current tab.** These are recorded for when pull-out returns (see Deferred).
- **Declaring popups (Q15, changed after the build: speed): flags in each `[[keys.command]] type = "popup"` line, in tmux-toggle-popup style.** Herdr opens its built-in popup at the bind's `width` and `height` and runs the command in it, with `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID`, and `HERDR_ACTIVE_PANE_CWD`. One Python process does all the work: the toggle script parses its flags, makes sure the backing pane exists, and then becomes the key-filter proxy in the same process. This saves one Python start and one `plugin.pane.open` call on each key press (about 155 → 100 ms on this Mac). When the proxy ends, the popup closes. Every error goes to a Herdr toast (`notification.show`), and the popup closes. Flags:
  - `--scope tab|workspace|pwd|session`: optional, default `workspace`. It sets where the popup is shared (see Scope)
  - `--name <label>`: optional. A label for the picker and the help header, which defaults to the command. It is not part of the popup id. The popup border always shows the title `popup`: Herdr 0.9.5 takes the title from the popup terminal's label, and a popup command cannot set it
  - `--toggle-key <key>`: can be repeated. Uses Herdr key syntax, including `prefix+<key>` chords (for example `--toggle-key prefix+f`). `prefix` means Herdr's `[keys] prefix` (`ctrl+;`), read at popup open, so changing your Herdr prefix changes every prefix toggle key with no bind edits
  - `-d <dir>`: start folder, used only when the popup is created (as in tmux)
  - `-- <command…>`: the program. Without it, the default shell runs.
- **Popup session layout (Q16): one shared `toggle-popup` Herdr session** for all Herdr sessions on a machine, like tmux-toggle-popup's single `popup` tmux server. One crash or stop ends every popup. Remote machines are separate (see Q19).
- **Scope and identity (Q17, Q18, changed after the build): `--scope`, with a computed popup id.** `--id` and the id format are removed. A key press means "find the popup with this popup id; show it if it exists, create it if not". The popup id is a hash of the scope key, the command, and the sorted `--toggle-key` flags, so `-d`, `--name`, and the bind's `width` and `height` do not change which popup you get. Two binds with the same scope, command and toggle keys share one popup. If you change a bind's toggle keys, the next press opens a new popup, and the old one runs until its scope closes. Scope keys:
  - `tab`: the session and tab id. `workspace`: the session and workspace id. `pwd`: the session and the active pane's current folder (`HERDR_ACTIVE_PANE_CWD`). `session`: the session.
  - Example with `--scope pwd` in session `work`: from `~/proj/shop` in workspace `api` or `web`, you get the same popup. From `~/proj/shop/src`, or from session `personal`, you get another one.
  - **Cleanup:** manifest hooks `[[events]] on = "tab.closed"` and `on = "workspace.closed"` close the `tab` and `workspace` popups of that tab or workspace. `pwd` and `session` popups close when their Herdr session is gone.
  - **Sweep for missed events:** a `[[startup]]` hook, and each toggle after the popup shows its program, close popups whose owner tab, workspace or Herdr session no longer exists. An owner session counts as gone only when its socket refuses or is missing; a timeout keeps the popups. The sweep also closes `toggle-popup` workspaces whose terminal does not match a saved record, such as empty shells that Herdr restores after the popup server restarts.
  - **Two clients on one Herdr session:** clients on the same tab see the same popup. A client on another tab gets Herdr's "Action rejected" notice with "popup already open", because Herdr allows one popup per session. A viewer that cannot attach shows Herdr's reason as a toast.
- **Remote machines (Q19): supported now.** Each Herdr machine runs its own server, and "custom commands and plugins advertised by the selected server still run there". In a remote workspace, the remote server runs the key and the plugin, and creates its own `toggle-popup` session on that host. Local and remote popups never mix. Requirements:
  - The code runs on macOS and Linux.
  - The remote host needs Python 3.11+ (as `python3` or `python3.N` on PATH), the plugin directory, the `[[keys.command]]` lines, and the link script, all installed by chezmoi.
- **E2E tests (Q20): containers plus a suite on the Mac host.** Tests live in `home/dot_config/herdr/toggle-popup/test/`, and `.chezmoiignore` excludes them from the target (as with `kitty-popup.yazi/test/`).
  - **Containers:** a Docker Compose pair, `client` and `remote` (sshd plus Herdr, Linux aarch64). The test runs a real Herdr client inside tmux in `client`: tmux is a test-only tool there. `tmux send-keys` presses keys and `tmux capture-pane` reads the screen. tmux `extended-keys` switches between legacy and kitty-style key encoding. `herdr machine add` runs only inside `client`, so it never writes the user's real saved-machine list.
  - **Mac host:** an isolated `herdr --session tp-e2e` with its own `HERDR_CONFIG_PATH`, never the default socket, and no `machine add`.
  - **Checks:** the screen, plus the backing panes in the `toggle-popup` session (`herdr --session toggle-popup pane read`), because a popup has no pane id.
- **Keys and sizes (Q21, binds changed after the build: speed):** toggle keys are free per popup. Inside and outside keys can match or differ, and `prefix+<key>` chords count. No `prefix+ctrl+<key>` binds. Planned binds in `home/dot_config/herdr/config.toml`:

  ```toml
  [[keys.command]]
  key = "prefix+f"
  type = "popup"
  description = "Toggle floating shell"
  width = "80%"
  height = "80%"
  command = 'exec ~/.config/herdr/toggle-popup/toggle.sh --name floating --toggle-key prefix+f -d "$HERDR_ACTIVE_PANE_CWD" -- nu'

  [[keys.command]]
  key = "alt+y"
  type = "popup"
  description = "Toggle Yazi"
  width = "80%"
  height = "80%"
  command = 'exec ~/.config/herdr/toggle-popup/toggle.sh --name yazi --toggle-key alt+y -d "$HERDR_ACTIVE_PANE_CWD" -- yazi'

  [[keys.command]]
  key = "alt+g"
  type = "popup"
  description = "Toggle lazygit for the Git root"
  width = "80%"
  height = "80%"
  command = 'root=$(git -C "$HERDR_ACTIVE_PANE_CWD" rev-parse --show-toplevel 2>/dev/null || printf %s "$HERDR_ACTIVE_PANE_CWD"); exec ~/.config/herdr/toggle-popup/toggle.sh --name lazygit --scope pwd --toggle-key alt+g -d "$root" -- lazygit-recent'
  ```

  The script name and path are fixed at build time. Sizes are all 80% × 80%, set by the bind. `ctrl+z` is not a toggle key, so it reaches the shell and yazi. The user adds second toggle keys later. With `--scope pwd`, lazygit is one popup per pane folder, not per repo (see Deferred: `--scope git`).
- **Scrollback (Q23):** only `prefix+e`, read from Herdr's `[keys] edit_scrollback`. It pauses the viewer and runs `herdr --session toggle-popup pane read <id> --source recent-unwrapped --lines N` into `$EDITOR` (nvim), with the cursor on the last line. Quitting returns to the live popup. `prefix+space` passes through to the program. If `edit_scrollback` is empty, a popup has no scrollback key.
- **Start folder (set by the tmux-parity rule):** `-d` applies only when a popup is created. Reopening keeps the program's current folder, as in tmux's `new-session -As … -c dir`. herdr-scratch's follow-the-pane `cd` belongs to the parity phase.
- **Errors and a popup that Herdr closes:**
  - Hooks write every error only to stderr, never as a toast: no key press caused them, and the next toggle's sweep repairs what they missed. The toggle script and the proxy show errors as toasts. Herdr shows the popup before Python starts, so on an error the empty popup shows for a moment, closes, and then the toast shows. A failed sweep inside the picker is only logged.
  - When Herdr closes the popup at any point, also during the help page, the picker, or the editor (SIGHUP, then SIGTERM), the proxy ends quietly: no toast and no more output. Its cleanup still runs: it stops the viewer and removes the scrollback temp file, which can hold secrets from the program's output. The editor gets its own SIGHUP from Herdr.
  - A failed scrollback read shows a toast, and the popup returns to the live program. Keys typed before the editor starts are dropped, so they never reach the program.
- **Program exit:** when the program exits (`exit`, or `q` in lazygit), its backing pane and workspace close, the viewer ends, and the popup closes. The next key press creates a new one. This is the same as tmux.
- **Engineering choices made without asking:**
  - **Popup session state:** each popup is one workspace in `toggle-popup`, labelled with its popup id. The `toggle-popup` session is where the plugin checks whether a popup exists, so a stale registry can never claim one that does not exist. A small per-popup JSON file in the plugin state directory stores the popup record (popup id, scope, label, terminal id, command, toggle keys, and the owner: session socket plus tab or workspace when the scope has one, or the folder for `pwd`), which the picker uses to load the keys of the popup it switches to.
  - **Starting the popup session:** the toggle script starts `herdr --session toggle-popup server` with a minimal config of its own (`HERDR_CONFIG_PATH`: no custom keys, onboarding off, and `[terminal] default_shell` copied from the main Herdr config, which is `nu` for this user). It removes `HERDR_SOCKET_PATH` from the environment first, as herdr-scratch does.
  - **Picker contents:** the `prefix` `g` picker lists only the popups of this Herdr session, like Herdr's goto list. The first group holds the `pwd` and `session` popups, under the session name. A `pwd` popup shows its folder, for example `~/proj/shop`. Then come the workspace groups, holding the `workspace` and `tab` popups, in the session's workspace order. The picker runs the sweep first.
  - **Picker keys and filter:** the `prefix` `g` picker has a filter field. Typed text filters the list with an fzf-style match: the letters must appear in order. The match checks the label, the command, the folder, and the group name, and the matched letters show in the accent color.
    - Up/down and `ctrl+n`/`ctrl+p` move. Enter switches.
    - Backspace, `ctrl+w` and `ctrl+u` edit the filter.
    - Esc clears the filter. When the filter is empty, Esc cancels, as in `navigation`'s move dialog. `ctrl+c` cancels.
    - The toggle keys and `prefix` `q`, `?` and `e` still work, and they come before filter text. `j`, `k` and `q` are filter text.
  - **Page look:** the help page and the picker use look A of the prototype (`.scratch/herdr-toggle-popup/prototypes/pages.py`).
    - A bold title, a dim origin on the right, and a rule under them.
    - A footer with key chips.
    - The selected row looks like the rows in `navigation`'s dialogs.
    - A green `●` marks the current popup.
    - The picker shows an "N of M" counter. With no result it shows `No popup matches "…"`.
    - All colors come from Herdr theme tokens. Nothing is hard-coded.
  - **Theme:** the plugin has its own copy of `navigation/herdr_theme.py`, and `.chezmoiexternals/herdr.toml` also downloads Herdr's `state.rs` and `theme.rs` into `.config/herdr/toggle-popup/herdr-src/`. `navigation` stays unchanged. The proxy reads the theme only when the help page or the picker opens. The theme read runs `defaults` (about 20 ms), so the toggle key stays as fast as before.
  - **Test trace:** `TOGGLE_POPUP_TRACE=<file>` makes the proxy append event names (for example `open`, `toggle-key`, `switch`) to that file, for the E2E tests. It never writes raw input bytes, so typed text such as passwords is never logged. It is off by default.
  - **No plugins in the popup server:** Herdr loads plugins from `$XDG_CONFIG_HOME/herdr/plugins.json`. The toggle script starts the `toggle-popup` server with a private `XDG_CONFIG_HOME`, so the server loads no plugins, and `navigation` and `session-titles` need no change. `launch.py` gives each popup program the user's real `XDG_CONFIG_HOME`, `SHELL` and `HERDR_CONFIG_PATH`.

## Verified facts

From the Herdr v0.9.5 source (`herdrdev/herdr`, tag `v0.9.5`) and the installed binary:

- **One popup per Herdr session:** `AppState.popup_pane: Option<…>` (`src/app/state.rs:876`). A second open fails with "popup already open" (`src/app/popup.rs:116`) or `ui_busy`.
- **Popup process lifecycle:** a popup always starts a new process (`popup.rs:99-170`). Closing it shuts down that process (`src/app/runtime.rs:30`).
- **No popup-to-pane move:** a popup terminal can never be attached to a tiled pane (`state.rs:1290`). A popup has no pane id and sends no events.
- **No moves between sessions:** each Herdr session is a separate server. No API adopts an existing terminal into a pane. `pane.move` works only inside one server (to a tab, a new tab, or a new workspace). Herdr has no hidden or detached terminals.
- **Popup binds:** a `type = "popup"` command runs through `/bin/sh -c` (`src/platform/macos.rs:206`) with the same `HERDR_*` env as a shell key (`src/app/custom_commands.rs:243`), minus the pane identity (`src/app/popup.rs:139`). It starts in the active pane's folder (`popup.rs:133`). The border title is the popup terminal's label, else `popup` (`src/server/client_shell.rs:514`). A refused open shows the client notice "Action rejected" with Herdr's reason (`src/client/shell/actions.rs:560`).
- **Opening and closing popups:** a popup opens only through `keys.command type = "popup"` or `plugin.pane.open` with `placement = "popup"`. There is no `popup.open` socket method. `popup.close` closes whichever popup is open.
- **Input while a popup is open:** all key, text, and paste input goes to the popup before any keybinding check (`src/client/shell/input.rs:632`). The socket API and plugin event hooks still work.
- **Viewer detach chord:** the `terminal attach` client has a fixed `ctrl+b q` detach chord (`src/client/attach.rs:63, 118-120`). Its CLI takes only `<terminal_id> [--takeover]`. The full client's `keys.detach` and `keys.prefix` can be changed (`src/config/model.rs:372`).
- **Nested clients:** the nested guard blocks only when `HERDR_ENV=1` is set and `[experimental] allow_nested` is false (`src/main.rs:452-479`). `terminal attach` runs before that guard.
- **`HERDR_CONFIG_PATH`** replaces the config file path (`src/config/io.rs:195`).
- **Plugin actions take no arguments:** `plugin.action.invoke` has only `action_id`, `plugin_id`, and `context`. A `plugin_action` keybinding passes only the action id.
- **`herdr api`** has only `schema` and `snapshot`, with no raw JSON calls (`src/cli/api.rs`).
- **Event payload:** the `workspace.closed` event payload carries `workspace_id` (`src/api/schema/events.rs:124`).
- **Hiding chrome:** these config options exist: `sidebar_start_collapsed`, `sidebar_collapsed_mode`, `hide_tab_bar_when_single_tab`, `allow_nested` (`src/config/model.rs`).
- **Scrollback:** `herdr pane read <id> --source visible|recent|recent-unwrapped|detection --lines N --format text|ansi` reads it.
- **Machines:** each machine keeps its own server. Custom commands and plugins run on the selected server. Pane and workspace ids are scoped to one server (Herdr docs, `connecting-machines`).
- **This Mac:** Herdr 0.9.5 at `/opt/homebrew/bin/herdr`, with one running session, `default` (`~/.config/herdr/herdr.sock`). Docker Desktop 29.9.2 (aarch64).
- **tmux-toggle-popup's default `--name` is `default`** (`src/variables.sh:4`).
- **herdr-scratch v1.0.1** (reference): it keeps terminals in a private `herdr-scratch` session and attaches popups to them. It hides popups with `popup.close` over the raw socket. Its actions are fixed in its manifest (`toggle`, `lazygit`, `notes`, …).

## Risks

- **Key decoding (highest risk):** the proxy must recognize toggle keys and `prefix` chords in legacy encoding, kitty keyboard protocol encoding, and modifyOtherKeys encoding, and pass everything else through byte for byte. Mitigation: a prototype of about 30 minutes before the rest of the build, then E2E tests in both encodings.
- **Image previews:** yazi image previews now pass through two layers, the popup and the attach viewer. The tmux setup needed `kitty-popup.yazi` for this. Check this in the prototype.
- **One server for all popups:** if the `toggle-popup` server crashes or stops, every popup on that machine ends.
- **Workspace id reuse:** a reused workspace id after a missed `workspace.closed` event could adopt an old popup. The sweep on startup and on each toggle reduces this risk.
- **Moving a tab:** Herdr gives a tab a new tab id when it moves to another workspace, so the `tab` popups of that tab close.
- **One popup at a time:** while any other popup is open (for example a `navigation` dialog), Herdr refuses the popup key itself with "popup already open". The user sees Herdr's "Action rejected" notice, not a toggle-popup toast.
- **Terminal size:** the attach client sets the terminal size, so a backing pane resizes to the popup size each time it is shown.
- **The viewer's `ctrl+b q` chord** stays active in every popup. The user assumes it can be changed; see Open threads.
- **Remote hosts** need Python 3.11+ and chezmoi before popup keys work. Until then, those keys show a toast: "python3 not found", or "toggle-popup needs Python 3.11+".

## Deferred

- **Pull-out (Q13; targets from Q11: split right, split down, new tab).** It comes back if Herdr adds moves between sessions or an API that adopts a terminal into a pane. Two partial ways exist today:
  - **Viewer pull-out:** a real split runs `herdr --session toggle-popup terminal attach <id> --takeover`. The program keeps running, but Herdr sees a viewer, not the program.
  - **Relaunch pull-out:** a real pane starts the same command in the backing pane's current folder, then the backing pane closes. This is fine for lazygit or yazi, but a shell loses its history and running jobs.
- **How to start a pull-out (Q12).** It comes back with pull-out. The earlier recommendation was a menu plus direct keys.
- **Plugin list installer (Q9).** The user said to skip it and focus on the plugin first. Its design is settled (Q1 pinned, Q2 add only): a `package.herdr` list in `home/.chezmoidata/package.yaml`, installed by `run_onchange_after_herdr-plugins.sh.tmpl`. It comes back when the plugin is done, or when the first GitHub plugin is wanted.
- **Feature parity with herdr-scratch** (follow-the-pane `cd`, resize and fullscreen, `list`/`status`, `send`/`run`) **and with tmux-toggle-popup** (on-init hooks, toggle modes). The user picks these one by one after the first version.
- **`--scope git`:** one popup per Git root of the active pane's folder, or the folder itself outside a repo. It would make lazygit one popup per repo. The user chose to add it in a later iteration.

## Open threads

- **The `ctrl+b q` detach chord.** The source shows that the `terminal attach` viewer hard-codes `ctrl+b q`. The user believes it can be changed and said to "assume that it works until I prove otherwise". This design does not depend on the chord. Each popup has its own toggle keys through the proxy.
