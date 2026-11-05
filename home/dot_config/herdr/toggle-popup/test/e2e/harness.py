"""A real Herdr client in tmux, isolated from the user's Herdr state.

A Stage has its own XDG config and state folders, its own tmux server, a main
session (default `tp-e2e`) with its own HERDR_CONFIG_PATH, and the plugin's
private `toggle-popup` session. Tests press keys with `tmux send-keys`, read the
screen with `tmux capture-pane`, and read backing panes with
`herdr --session toggle-popup pane read`.
"""

import contextlib
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

E2E = Path(__file__).resolve().parent
PLUGIN = E2E.parents[1]
sys.path.insert(0, str(PLUGIN))
from python_guard import TITLE  # noqa: E402

# The title line of a plugin toast on the screen.
TOAST_TITLE = f"● {TITLE}"
REPO_CONFIG = PLUGIN.parent / "config.toml"
# The user's other Herdr plugins, next to this one in the repo.
OTHER_PLUGINS = (PLUGIN.parent / "navigation", PLUGIN.parent / "session-titles")
POPUP_FRAME = re.compile("┌─{40,}┐")
TIMEOUT = float(os.environ.get("E2E_TIMEOUT", "15"))

# Keys that run a slot file. A test writes the slot, then presses its key.
SLOT_KEYS = ("alt+1", "alt+2", "alt+3", "alt+4", "alt+5")
DROPPED_ENV = ("SSH_AUTH_SOCK", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TMUX", "TMUX_PANE",
               "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "EDITOR", "VISUAL")


def wait_for(probe, what, timeout=TIMEOUT):
    """Poll probe() until it returns a true value. Return that value."""
    deadline = time.monotonic() + timeout
    last = None
    while True:
        try:
            last = probe()
        except (OSError, ValueError, KeyError) as error:
            last = error
        else:
            if last:
                return last
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}; last value: {last!r}")
        time.sleep(0.05)


def call(endpoint, method, params=None, timeout=5.0):
    """One raw Herdr socket API request. Raise RuntimeError on an API error."""
    request = {"id": "e2e", "method": method, "params": params or {}}
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(timeout)
        client.connect(str(endpoint))
        client.sendall((json.dumps(request) + "\n").encode())
        line = client.makefile("rb").readline()
    response = json.loads(line)
    if "error" in response:
        raise RuntimeError(f"{method}: {response['error']}")
    return response["result"]


def herdr_answers(endpoint):
    """True when a Herdr server answers ping at `endpoint`."""
    try:
        call(endpoint, "ping", timeout=1.0)
    except (OSError, ValueError):
        return False
    return True


def close_popup(endpoint):
    """Close the open popup of a session. No open popup is no error."""
    try:
        call(endpoint, "popup.close")
    except RuntimeError as error:
        if "popup_not_open" not in str(error):
            raise


class Stage:
    def __init__(self, name, prefix="ctrl+;", extended_keys="always", session="tp-e2e",
                 real_binds=False, width=200, height=50, xdg_config_home=True,
                 plugins=(PLUGIN,)):
        """Without `xdg_config_home`, the stage has no XDG_CONFIG_HOME: Herdr
        then uses $HOME/.config, which is in the stage too. `plugins` are the
        plugin folders that the main session links."""
        self.name = name
        self.prefix = prefix
        self.session = session
        self.plugins = plugins
        # Unix socket paths must stay short (104 bytes on macOS).
        self.root = Path(tempfile.mkdtemp(prefix="tpe", dir="/tmp"))
        try:
            self._setup(xdg_config_home, real_binds, extended_keys, width, height)
        except BaseException:
            # No close() runs for a stage that did not finish its setup.
            shutil.rmtree(self.root, ignore_errors=True)
            raise

    def _setup(self, xdg_config_home, real_binds, extended_keys, width, height):
        self.xdg_config_home = xdg_config_home
        self.config_home = self.root / "c" if xdg_config_home else self.root / "home" / ".config"
        self.state_home = self.root / "s"
        self.config_home.mkdir(parents=True)
        self.state_home.mkdir()
        self.slots = self.root / "slots"
        self.slots.mkdir()
        self.tmux_socket = f"tpe-{os.getpid()}-{self.name}"
        self.width, self.height = width, height
        self.editor_out = self.root / "editor.json"
        self.trace_path = self.root / "trace.txt"
        # Herdr sessions of more clients: tmux session name -> Herdr session name.
        self.clients = {}
        # The text of each plugin toast that a screen showed, for failure messages.
        self.toasts = []
        self.env = self._env()
        self.main_config = self.root / "main.toml"
        self.main_config.write_text(self._main_config(real_binds), encoding="utf-8")
        self.env["HERDR_CONFIG_PATH"] = str(self.main_config)
        tmux_conf = self.root / "tmux.conf"
        tmux_conf.write_text("\n".join([
            "set -g escape-time 0",
            "set -g status off",
            'set -g default-terminal "xterm-256color"',
            f"set -g extended-keys {extended_keys}",
            "set -g extended-keys-format csi-u",
            "",
        ]), encoding="utf-8")
        self.tmux_conf = tmux_conf

    # Setup and teardown

    def _env(self):
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("HERDR_", "TOGGLE_POPUP_")) and key not in DROPPED_ENV}
        home = self.root / "home"
        home.mkdir(exist_ok=True)
        env.update({
            # Programs in popups (lazygit-recent, nu, yazi) keep state under HOME.
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(self.config_home),
            "XDG_STATE_HOME": str(self.state_home),
            "XDG_CACHE_HOME": str(self.root / "cache"),
            # tmux gives its panes SHELL: its default-shell, which is $SHELL when
            # it is set. A fixed value makes the user's SHELL known to the tests.
            "SHELL": "/bin/sh",
            "PYTHONDONTWRITEBYTECODE": "1",
            "EDITOR": f"{shlex.quote(sys.executable)} {shlex.quote(str(E2E / 'fake_editor.py'))}",
            "E2E_EDITOR_OUT": str(self.editor_out),
            "TOGGLE_POPUP_TRACE": str(self.trace_path),
        })
        if not self.xdg_config_home:
            del env["XDG_CONFIG_HOME"]
        return env

    def _main_config(self, real_binds):
        lines = ["onboarding = false", "", "[keys]", f"prefix = {json.dumps(self.prefix)}",
                 'edit_scrollback = "prefix+e"', ""]
        for key in SLOT_KEYS:
            slot = self.slots / f"{key.replace('+', '-')}.sh"
            lines += ["[[keys.command]]", f"key = {json.dumps(key)}", 'type = "shell"',
                      f"command = {json.dumps('. ' + shlex.quote(str(slot)))}", ""]
        if real_binds:
            lines += self.real_binds()
        # Show toasts in Herdr, as the user's config does.
        lines += ["[terminal]", f"default_shell = {json.dumps(str(self.shell()))}", "",
                  "[ui.toast]", 'delivery = "herdr"', ""]
        return "\n".join(lines)

    def shell(self):
        """A plain sh, the same on macOS and Linux. Its prompt is the folder name and the tab id.

        Herdr gives each pane its tab id in HERDR_TAB_ID, so a test can wait
        until the client shows a tab.
        """
        path = self.root / "shell.sh"
        path.write_text("#!/bin/sh\nunset ENV\nexport PS1='${PWD##*/} ${HERDR_TAB_ID:-}$ '\n"
                        "exec /bin/sh -i\n", encoding="utf-8")
        path.chmod(0o755)
        return path

    @staticmethod
    def real_binds():
        """The repo's toggle-popup binds, with the script path pointed at this checkout."""
        lines, block = [], []
        for line in REPO_CONFIG.read_text(encoding="utf-8").splitlines() + [""]:
            if line.startswith("[") and block:
                if any("toggle_popup.py" in item for item in block):
                    lines += block
                block = []
            if line.startswith("[[keys.command]]") or block:
                block.append(line)
        target = "~/.config/herdr/toggle-popup/"
        if not lines or not all(target in line for line in lines if "toggle_popup.py" in line):
            raise AssertionError(f"toggle-popup binds not found in {REPO_CONFIG}")
        text = "\n".join(lines).replace(target, str(PLUGIN) + "/")
        return text.splitlines() + [""]

    def start(self):
        self.tmux("-f", str(self.tmux_conf), "new-session", "-d", "-s", "main",
                  "-c", str(self.root),
                  "-x", str(self.width), "-y", str(self.height),
                  f"exec {shlex.quote(self.herdr_bin)} --session {self.session}")
        wait_for(lambda: call(self.socket, "ping") is not None, "the main Herdr server")
        for path in self.plugins:
            call(self.socket, "plugin.link", {"path": str(path), "enabled": True})
        wait_for(self.plugin_enabled, "the toggle-popup plugin")
        # A new client opens one workspace in its start folder.
        wait_for(lambda: self.main_snapshot()["focused_workspace_id"], "the first workspace")
        self.wait_prompt()
        return self

    def wait_prompt(self, target="main"):
        def probe():
            return any(line.rstrip().endswith("$")
                       for line in self.screen(target).splitlines())
        wait_for(probe, "a shell prompt")

    def add_client(self, target, session):
        """Start one more Herdr client, for SESSION, in the tmux session TARGET.

        It has the same config and plugins. Key and screen helpers take TARGET.
        """
        self.tmux("new-session", "-d", "-s", target, "-c", str(self.root),
                  "-x", str(self.width), "-y", str(self.height),
                  f"exec {shlex.quote(self.herdr_bin)} --session {session}")
        self.clients[target] = session
        endpoint = self.session_socket(session)
        wait_for(lambda: call(endpoint, "ping") is not None, f"the {session} server")
        wait_for(lambda: call(endpoint, "session.snapshot")["snapshot"]["focused_workspace_id"],
                 f"the first workspace of {session}")
        self.wait_prompt(target)
        return endpoint

    def new_workspace(self, label, folder=None):
        """Create and focus a workspace with a shell. Return its id.

        The shell starts in FOLDER, or in a new folder named LABEL.
        """
        folder = Path(folder or self.root / label)
        folder.mkdir(parents=True, exist_ok=True)
        created = call(self.socket, "workspace.create",
                       {"label": label, "cwd": str(folder), "focus": True})
        self.wait_tab(created["tab"]["tab_id"])
        return created["workspace"]["workspace_id"]

    def new_tab(self, workspace_id, folder=None):
        """Create and focus a tab with a shell in a workspace. Return its id."""
        params = {"workspace_id": workspace_id, "focus": True}
        if folder:
            params["cwd"] = str(folder)
        tab_id = call(self.socket, "tab.create", params)["tab"]["tab_id"]
        self.wait_tab(tab_id)
        return tab_id

    def show_tab(self, tab_id):
        """Focus a tab, and wait until the client shows it."""
        call(self.socket, "tab.focus", {"tab_id": tab_id})
        self.wait_tab(tab_id)

    def wait_tab(self, tab_id, target="main"):
        """Wait until a client shows the shell prompt of a tab (see shell())."""
        self.wait(lambda: any(line.rstrip().endswith(f" {tab_id}$")
                              for line in self.screen(target).splitlines()),
                  f"the prompt of tab {tab_id} on {target}")

    def focused_tab(self):
        return self.main_snapshot()["focused_tab_id"]

    def plugin_enabled(self):
        plugins = call(self.socket, "plugin.list").get("plugins", [])
        return any(item.get("plugin_id", item.get("id")) == "dotfiles.toggle-popup"
                   and item.get("enabled", True) for item in plugins)

    def close(self):
        """Stop the servers and remove the files. One failed step does not stop the rest."""
        for session in (self.session, *self.clients.values(), "toggle-popup"):
            with contextlib.suppress(subprocess.SubprocessError, OSError):
                self.herdr("--session", session, "server", "stop", check=False)
        with contextlib.suppress(subprocess.SubprocessError, OSError):
            self.tmux("kill-server", check=False)
        # tmux leaves its socket file behind after kill-server.
        folder = Path(self.env.get("TMUX_TMPDIR") or "/tmp") / f"tmux-{os.getuid()}"
        (folder / self.tmux_socket).unlink(missing_ok=True)
        shutil.rmtree(self.root, ignore_errors=True)

    # Process helpers

    @property
    def herdr_bin(self):
        return shutil.which("herdr") or "herdr"

    def tmux(self, *args, check=True):
        result = subprocess.run(["tmux", "-L", self.tmux_socket, *args], env=self.env,
                                capture_output=True, text=True)
        if check and result.returncode:
            raise RuntimeError(f"tmux {' '.join(args)}: {result.stderr.strip()}")
        return result.stdout

    def herdr(self, *args, check=True):
        result = subprocess.run([self.herdr_bin, *args], env=self.env, capture_output=True,
                                text=True, timeout=30)
        if check and result.returncode:
            raise RuntimeError(f"herdr {' '.join(args)}: {result.stderr.strip()}")
        return result.stdout

    def session_socket(self, session):
        return self.config_home / "herdr" / "sessions" / session / "herdr.sock"

    @property
    def socket(self):
        return self.session_socket(self.session)

    @property
    def popup_socket(self):
        return self.session_socket("toggle-popup")

    # Input

    def keys(self, *keys, target="main"):
        """Press tmux key names, one send-keys call each (for example "C-\\;", "f")."""
        for key in keys:
            self.tmux("send-keys", "-t", target, key)

    def text(self, text, target="main"):
        self.tmux("send-keys", "-t", target, "-l", text)

    def prefix_keys(self):
        """The tmux key name of this stage's Herdr prefix."""
        return {"ctrl+;": "C-\\;", "ctrl+a": "C-a", "ctrl+b": "C-b"}[self.prefix]

    def chord(self, key):
        self.keys(self.prefix_keys(), key)

    # Slots

    def slot(self, key, *argv, cwd=None):
        """Bind KEY to `toggle_popup.py ARGV...`."""
        script = PLUGIN / "toggle_popup.py"
        line = " ".join(shlex.quote(item) for item in ["exec", "python3", str(script), *argv])
        if cwd:
            line = f"cd {shlex.quote(str(cwd))} && {line}"
        (self.slots / f"{key.replace('+', '-')}.sh").write_text(line + "\n", encoding="utf-8")

    def keylog_command(self, mode, log):
        return ["python3", str(E2E / "keylog.py"), mode, str(log)]

    # Output

    def screen(self, target="main"):
        """The screen of a client. Raise when its tmux session is gone.

        The client runs as `exec herdr`, so a crash of the client ends the
        session. An empty screen must not pass a "popup is gone" check.
        """
        text = self.tmux("capture-pane", "-p", "-t", target)
        self._keep_toasts(target, text)
        return text

    def screen_text(self, target="main"):
        """screen() for a failure message: an error becomes its text."""
        try:
            return self.screen(target)
        except (RuntimeError, OSError) as error:
            return f"no screen: {error}"

    def _keep_toasts(self, target, text):
        """Keep the plugin toasts on a screen: a toast can go before a test fails."""
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if TOAST_TITLE not in line:
                continue
            column = line.index(TOAST_TITLE) - 1
            body = []
            for below in lines[index + 1:]:
                part = below[column:]
                if not part.startswith("│"):
                    break
                body.append(part.strip("│ "))
            toast = f"{target}: {' '.join(body)}"
            if toast not in self.toasts:
                self.toasts.append(toast)

    def wait(self, probe, what, timeout=TIMEOUT):
        """wait_for(), with the screen and the plugin logs in the failure message."""
        try:
            return wait_for(probe, what, timeout)
        except AssertionError as error:
            raise AssertionError(f"{error}\n{self.diagnose()}") from None

    def diagnose(self):
        trace = self.trace_path.read_text() if self.trace_path.exists() else ""
        screens = "".join(f"--- {target} screen\n{self.screen_text(target)}\n"
                          for target in ("main", *self.clients))
        toasts = "".join(f"{toast}\n" for toast in self.toasts)
        return (f"{screens}--- toasts seen\n{toasts}--- popups\n{self.popup_panes_text()}\n"
                f"--- proxy event trace\n{trace[-3000:]}\n{self.plugin_log()}")

    def popup_visible(self, target="main"):
        """True while a popup frame shows. Toasts are smaller than any test popup."""
        return any(POPUP_FRAME.search(line) for line in self.screen(target).splitlines())

    def popup_lines(self, target="main"):
        """The text rows inside the popup frame, without the frame and trailing spaces."""
        lines = self.screen(target).splitlines()
        top = next((index for index, line in enumerate(lines) if POPUP_FRAME.search(line)), None)
        if top is None:
            return []
        start = POPUP_FRAME.search(lines[top]).start()
        end = lines[top].index("┐", start)
        rows = []
        for line in lines[top + 1:]:
            if line[start:start + 1] != "│":
                break
            rows.append(line[start + 1:end].rstrip())
        return rows

    def wait_popup_closed(self, target="main"):
        self.wait(lambda: not self.popup_visible(target), f"the popup frame on {target} to go")

    def wait_screen(self, text, present=True, what=None, target="main"):
        def probe():
            return (text in self.screen(target)) == present
        where = f"the {target} screen"
        return self.wait(probe, what or f"{text!r} {'on' if present else 'off'} {where}")

    def popup_panes(self):
        """Live popups by id: the workspaces of the toggle-popup session.

        Raise when the popup session does not answer. A popup server that
        crashed or hangs has no popups, but a "popup is gone" check must not
        pass because of that.
        """
        snapshot = call(self.popup_socket, "session.snapshot")["snapshot"]
        panes = {pane["workspace_id"]: pane for pane in snapshot["panes"]}
        return {item["label"]: panes.get(item["workspace_id"])
                for item in snapshot["workspaces"]}

    def started_popup_panes(self):
        """popup_panes(), or {} when the popup session did not start yet (no socket file)."""
        return self.popup_panes() if self.popup_socket.exists() else {}

    def popup_panes_text(self):
        """popup_panes() for a failure message. No state of Herdr may hide the real failure.

        A hang is a TimeoutError (an OSError). An empty reply is a ValueError.
        """
        try:
            return repr(self.popup_panes())
        except (OSError, ValueError, KeyError, RuntimeError) as error:
            return f"no answer: {error!r}"

    def pane_text(self, popup_id, source="recent"):
        """The text of a popup, or "" while it does not show it yet. For waits only.

        A wait for text fails at its timeout anyway. A check that text is
        absent must use read_pane(): "" must not pass it.
        """
        pane = self.popup_panes().get(popup_id)
        if pane is None:
            return ""
        return self.herdr("--session", "toggle-popup", "pane", "read", pane["pane_id"],
                          "--source", source, check=False)

    def read_pane(self, popup_id, source="recent"):
        """The text of a popup. Raise when the popup has no pane or the read fails."""
        pane = self.popup_panes().get(popup_id)
        if pane is None:
            raise RuntimeError(f"popup {popup_id} has no pane")
        return self.herdr("--session", "toggle-popup", "pane", "read", pane["pane_id"],
                          "--source", source)

    def wait_pane(self, popup_id, text, what=None):
        return self.wait(lambda: text in self.pane_text(popup_id),
                         what or f"{text!r} in popup {popup_id}")

    def main_snapshot(self):
        return call(self.socket, "session.snapshot")["snapshot"]

    def focused_workspace(self):
        return self.main_snapshot()["focused_workspace_id"]

    def record_files(self):
        # The plugin makes the folder with its first record.
        folder = self.state_home / "herdr" / "plugins" / "dotfiles.toggle-popup" / "popups"
        return sorted(folder.glob("*.json")) if folder.exists() else []

    def records(self):
        """The saved popup records by popup id, as JSON data.

        The plugin replaces a record file in one step, so each file is complete.
        """
        records = [json.loads(path.read_text(encoding="utf-8")) for path in self.record_files()]
        return {record["id"]: record for record in records}

    def popup_ids(self, label, socket=None):
        """The sorted ids of the live popups with this label, of one session if SOCKET is set."""
        live = self.started_popup_panes()
        return sorted(popup_id for popup_id, record in self.records().items()
                      if record["label"] == label and popup_id in live
                      and (socket is None or record["owner"]["socket"] == str(socket)))

    def popup_id(self, label, socket=None):
        """The id of the one live popup with this label. Wait until there is exactly one."""
        def probe():
            ids = self.popup_ids(label, socket)
            return ids[0] if len(ids) == 1 else None
        return self.wait(probe, f"one popup labelled {label!r}")

    def plugin_log(self):
        """Failed plugin commands of both sessions, to show in failure messages."""
        parts = []
        for endpoint in (self.socket, self.popup_socket):
            try:
                logs = call(endpoint, "plugin.log.list", {"limit": 50})["logs"]
            except (OSError, ValueError, RuntimeError) as error:
                parts.append(f"--- plugin logs of {endpoint}: {error}")
                continue
            failed = [item for item in logs if item.get("status") != "succeeded"]
            parts.append(f"--- failed plugin commands of {endpoint}: {len(failed)}")
            parts += [f"{item.get('event') or item.get('command')}: {item.get('status')} "
                      f"{(item.get('stderr') or '')[-800:]}" for item in failed[-5:]]
        return "\n".join(parts)
