"""End-to-end tests: a real Herdr client in tmux opens toggle popups.

Each test class starts one isolated Stage (see harness.py). The outer key
encoding is tmux `extended-keys`: off sends legacy bytes, always sends CSI u.
The inner key encoding is the mode the popup program asks for (keylog.py).
"""

import contextlib
import fcntl
import json
import os
import re
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import harness
import proxy
import python_guard
from harness import OTHER_PLUGINS, PLUGIN, Stage, call, close_popup, wait_for

INNER_MODES = ("legacy", "kitty", "kitty-all", "mok")

# How Herdr encodes a key for a program in each inner mode.
ENCODED = {
    "ctrl+a": {"legacy": b"\x01", "kitty": b"\x1b[97;5u", "kitty-all": b"\x1b[97;5u",
               "mok": b"\x1b[27;5;97~"},
    "ctrl+;": {"legacy": b"\x1b[59;5u", "kitty": b"\x1b[59;5u", "kitty-all": b"\x1b[59;5u",
               "mok": b"\x1b[27;5;59~"},
    "x": {"legacy": b"x", "kitty": b"x", "kitty-all": b"\x1b[120u", "mok": b"x"},
    "alt+x": {"legacy": b"\x1bx", "kitty": b"\x1b[120;3u", "kitty-all": b"\x1b[120;3u",
              "mok": b"\x1b[27;3;120~"},
}
# How Herdr encodes the keys a, Z, alt+x, Enter, Up, Tab, and ctrl+d in each inner mode.
PASS_THROUGH = {
    "legacy": b"aZ\x1bx\r\x1b[A\t\x04",
    "kitty": b"aZ\x1b[120;3u\r\x1b[A\t\x1b[100;5u",
    "kitty-all": b"\x1b[97u\x1b[122;2u\x1b[120;3u\x1b[13u\x1b[1;1:1A\x1b[9u\x1b[100;5u",
    "mok": b"a\x1b[27;2;90~\x1b[27;3;120~\r\x1b[A\t\x1b[27;5;100~",
}


def logged(path):
    """All bytes that keylog.py read, in order. No log yet: the program did not start."""
    try:
        lines = Path(path).read_text(encoding="ascii").split()
    except FileNotFoundError:
        return b""
    return bytes.fromhex("".join(lines))


class StageCase(unittest.TestCase):
    """One Stage for each test class. Each test starts with no popups."""

    PREFIX = "ctrl+;"
    EXTENDED_KEYS = "always"
    REAL_BINDS = False
    XDG_CONFIG_HOME = True
    PLUGINS = (PLUGIN,)
    THEME = None

    @classmethod
    def setUpClass(cls):
        cls.stage = Stage(cls.__name__.lower(), prefix=cls.PREFIX,
                          extended_keys=cls.EXTENDED_KEYS, real_binds=cls.REAL_BINDS,
                          xdg_config_home=cls.XDG_CONFIG_HOME, plugins=cls.PLUGINS,
                          theme=cls.THEME)
        try:
            cls.stage.start()
        except BaseException:
            cls.stage.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.stage.close()

    def setUp(self):
        self.s = self.stage
        self.home = self.s.focused_workspace()
        self.addCleanup(self.reset)

    def reset(self):
        """Close an open popup and every backing popup, so tests do not share state."""
        close_popup(self.s.socket)
        for pane in self.s.started_popup_panes().values():
            if pane:
                try:
                    call(self.s.popup_socket, "workspace.close",
                         {"workspace_id": pane["workspace_id"]})
                except RuntimeError as error:
                    # A cleanup closed a tab or workspace, so a plugin hook
                    # can close its popups at the same time.
                    if "workspace_not_found" not in str(error):
                        raise
        self.s.wait(lambda: not self.s.started_popup_panes(), "no backing popups")
        self.s.wait_popup_closed()
        call(self.s.socket, "workspace.focus", {"workspace_id": self.home})


class Scenarios:
    """Tests that run once for each outer key encoding."""

    # Helpers

    def keylog_slot(self, key, name, mode="legacy", toggles=("ctrl+z", "prefix+f")):
        log = self.s.root / f"{name}.log"
        argv = ["--name", name]
        for toggle in toggles:
            argv += ["--toggle-key", toggle]
        self.s.slot(key, *argv, "--", *self.s.keylog_command(mode, log))
        return log

    def open_keylog(self, key, name, mode="legacy", **kwargs):
        log = self.keylog_slot(key, name, mode, **kwargs)
        self.press_slot(key)
        self.s.wait_screen(f"keylog {mode} ready")
        return log

    def press_slot(self, key):
        self.s.keys({"alt+1": "M-1", "alt+2": "M-2", "alt+3": "M-3", "alt+4": "M-4",
                     "alt+5": "M-5"}[key])

    def wait_logged(self, log, data):
        return self.s.wait(lambda: logged(log).endswith(data), f"{data!r} at the program")

    def wait_closed(self, marker):
        self.s.wait_screen(marker, present=False, what="the popup to close")
        self.s.wait_popup_closed()

    # Tests

    def test_toggle_keys_hide_the_popup_and_keep_the_program(self):
        for index, mode in enumerate(INNER_MODES):
            with self.subTest(mode=mode):
                name = f"toggle-{mode}"
                log = self.open_keylog("alt+1", name, mode)
                popup_id = self.s.popup_id(name)
                self.assertIn(popup_id, self.s.popup_panes())
                pane = self.s.popup_panes()[popup_id]
                self.s.text("ab")
                self.s.wait_pane(popup_id, "got ")
                self.s.keys("C-z")
                self.wait_closed(f"keylog {mode} ready")
                self.press_slot("alt+1")
                self.s.wait_screen(f"keylog {mode} ready")
                self.s.chord("f")
                self.wait_closed(f"keylog {mode} ready")
                # The same program still runs, and it never saw a toggle key.
                self.assertEqual(self.s.popup_panes()[popup_id]["terminal_id"],
                                 pane["terminal_id"])
                expected = b"ab" if mode != "kitty-all" else b"\x1b[97u\x1b[98u"
                self.assertEqual(logged(log), expected)
                self.assertEqual(len(self.s.record_files()), index + 1)

    def test_other_keys_reach_the_program_unchanged(self):
        for mode in INNER_MODES:
            with self.subTest(mode=mode):
                log = self.open_keylog("alt+1", f"pass-{mode}", mode)
                self.s.text("aZ")
                self.s.keys("M-x", "Enter", "Up", "Tab", "C-d")
                expected = PASS_THROUGH[mode]
                # Byte for byte what Herdr sends to a program in this mode.
                self.s.wait(lambda log=log, expected=expected: logged(log) == expected,
                            f"{expected!r} at the program ({mode})")
                self.s.keys("C-z")
                self.wait_closed(f"keylog {mode} ready")

    def test_the_trace_holds_event_names_and_never_typed_input(self):
        self.s.trace_path.unlink(missing_ok=True)
        log = self.open_keylog("alt+1", "secret")
        self.s.text("hunter2")
        self.s.keys("Enter")
        self.wait_logged(log, b"hunter2\r")
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")
        popup_id = self.s.popup_id("secret")
        path = self.s.trace_path
        self.s.wait(lambda: path.exists() and f"{popup_id}\ttoggle-key" in path.read_text(),
                    "the toggle-key event in the trace")
        trace = path.read_text()
        events = [line for line in trace.splitlines() if line.startswith(f"{popup_id}\t")]
        self.assertEqual(events, [f"{popup_id}\topen", f"{popup_id}\ttoggle-key"])
        for secret in ("hunter2", b"hunter2".hex(), b"hunter2".hex(" "), "hunter"):
            self.assertNotIn(secret, trace)

    def test_prefix_twice_sends_one_prefix_and_other_chords_pass(self):
        prefix_key = self.s.prefix_keys()
        for mode in INNER_MODES:
            with self.subTest(mode=mode):
                log = self.open_keylog("alt+1", f"chord-{mode}", mode)
                self.s.keys(prefix_key, prefix_key)
                self.s.chord("x")
                prefix = ENCODED[self.PREFIX][mode]
                expected = prefix + prefix + ENCODED["x"][mode]
                self.wait_logged(log, expected)
                self.assertEqual(logged(log), expected)
                self.s.keys("C-z")
                self.wait_closed(f"keylog {mode} ready")

    def test_prefix_q_kills_the_popup(self):
        self.open_keylog("alt+1", "kill")
        popup_id = self.s.popup_id("kill")
        self.s.chord("q")
        self.wait_closed("keylog legacy ready")
        self.s.wait(lambda: popup_id not in self.s.popup_panes(), "the backing popup to close")
        self.assertEqual(self.s.record_files(), [])
        # The next press starts a new program.
        self.press_slot("alt+1")
        self.s.wait_screen("keylog legacy ready")
        self.assertNotIn("got ", self.s.read_pane(popup_id))

    def test_changed_toggle_keys_open_another_popup(self):
        self.open_keylog("alt+1", "rebind", toggles=("ctrl+z",))
        first = self.s.popup_id("rebind")
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")
        # The user edits the bind. The toggle keys are part of the popup id.
        log = self.keylog_slot("alt+1", "rebind", toggles=("ctrl+x",))
        log.unlink()
        self.press_slot("alt+1")
        self.s.wait_screen("keylog legacy ready")
        ids = self.s.wait(lambda: len(self.s.popup_ids("rebind")) == 2
                          and self.s.popup_ids("rebind"), "a second popup")
        # The new popup has only the new keys: ctrl+z reaches its program.
        self.s.keys("C-z")
        self.wait_logged(log, b"\x1a")
        self.s.keys("C-x")
        self.wait_closed("keylog legacy ready")
        self.assertEqual(logged(log), b"\x1a")
        # The old popup keeps running until its scope closes.
        self.assertIn(first, ids)
        self.assertEqual(self.s.popup_ids("rebind"), ids)

    def test_prefix_question_mark_shows_the_keys(self):
        self.open_keylog("alt+1", "help", toggles=("ctrl+z", "prefix+f"))
        self.s.chord("?")
        self.s.wait_screen("help popup")
        rows = self.s.popup_lines()
        self.assertTrue(rows[0].endswith(f"{self.s.popup_id('help')} · prefix {self.PREFIX}"),
                        rows)
        prefix = re.escape(self.PREFIX)
        text = "\n".join(rows)
        self.assertRegex(text, r"\n     ctrl\+z\s+hide this popup\n")
        self.assertRegex(text, rf"\n     {prefix}   f\s+hide this popup\n")
        self.assertRegex(text, rf"\n     {prefix}   e\s+edit the scrollback in \$EDITOR\n")
        self.assertIn("any key  back to the program", text)
        self.s.text("j")
        self.s.wait_screen("keylog legacy ready")
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")
        self.assertEqual(logged(self.s.root / "help.log"), b"")

    def test_prefix_g_switches_to_another_popup(self):
        self.open_keylog("alt+1", "first")
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")
        self.s.slot("alt+2", "--name", "second", "--toggle-key", "alt+s", "--",
                    *self.s.keylog_command("mok", self.s.root / "second.log"))
        self.press_slot("alt+2")
        self.s.wait_screen("keylog mok ready")
        self.s.chord("g")
        self.s.wait_screen("Switch popup")
        self.assertIn(" │ › second ● ", self.s.screen())
        self.s.keys("Up")
        self.s.wait_screen(" │ › first ")
        self.s.keys("Enter")
        self.s.wait_screen("keylog legacy ready")
        # The keys of the shown popup apply: ctrl+z hides "first", alt+s does not.
        self.s.keys("M-s")
        self.wait_logged(self.s.root / "first.log", ENCODED["alt+x"]["legacy"].replace(b"x", b"s"))
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")

    def test_prefix_e_opens_the_scrollback_in_the_editor(self):
        self.s.editor_out.unlink(missing_ok=True)
        self.open_keylog("alt+1", "scroll")
        self.s.text("hello")
        self.s.wait_pane(self.s.popup_id("scroll"), "got b'h")
        self.s.chord("e")
        out = self.s.wait(lambda: self.s.editor_out.exists() and self.s.editor_out.read_text(),
                          "the editor to run")
        result = json.loads(out)
        self.assertEqual(result["args"][0], "+")
        self.assertIn("keylog legacy ready", result["text"])
        self.assertIn("got b'h", result["text"])
        # Back in the live popup after the editor exits.
        self.s.text("z")
        self.wait_logged(self.s.root / "scroll.log", b"z")
        self.s.keys("C-z")
        self.wait_closed("keylog legacy ready")

    def test_a_popup_that_closes_in_the_editor_removes_the_scrollback_file(self):
        # The scrollback file can hold secrets. Herdr ends a closed popup with SIGHUP.
        out = self.s.editor_out
        out.unlink(missing_ok=True)
        hold, caught = out.with_name(out.name + ".hold"), out.with_name(out.name + ".signal")
        caught.unlink(missing_ok=True)
        hold.write_text("")
        self.addCleanup(hold.unlink, missing_ok=True)
        self.open_keylog("alt+1", "scroll-hup")
        self.s.chord("e")
        text = self.s.wait(lambda: out.exists() and out.read_text(), "the editor to run")
        path = Path(json.loads(text)["args"][-1])
        self.assertTrue(path.exists())
        self.addCleanup(path.unlink, missing_ok=True)
        toasts = list(self.s.toasts)
        call(self.s.socket, "popup.close")
        self.s.wait_popup_closed()
        self.s.wait(lambda: not path.exists(), "the scrollback file to go")
        # The editor gets its own SIGHUP from Herdr, so that it can end as it does in a shell.
        self.assertEqual(self.s.wait(lambda: caught.exists() and caught.read_text(),
                                     "the editor to get a signal"), "SIGHUP")
        # Herdr closed the popup: the proxy ends quietly.
        for _ in range(10):
            self.s.screen()
            time.sleep(0.1)
        self.assertEqual(self.s.toasts, toasts)

    def test_program_exit_closes_the_popup(self):
        self.s.slot("alt+1", "--name", "shell", "--toggle-key", "ctrl+z", "--",
                    "/bin/sh", "-c", "echo shell-started; exec /bin/sh")
        self.press_slot("alt+1")
        self.s.wait_screen("shell-started")
        popup_id = self.s.popup_id("shell")
        self.s.text("exit")
        self.s.keys("Enter")
        self.wait_closed("shell-started")
        self.s.wait(lambda: popup_id not in self.s.popup_panes(), "the backing popup to close")

    def test_start_folder_applies_only_when_the_popup_is_created(self):
        first, second = self.s.root / "first", self.s.root / "second"
        first.mkdir(exist_ok=True)
        second.mkdir(exist_ok=True)
        command = ["--", "/bin/sh", "-c", "pwd -P; exec /bin/sh"]
        self.s.slot("alt+1", "--name", "folder", "--toggle-key", "ctrl+z", "-d", str(first),
                    *command)
        self.press_slot("alt+1")
        popup_id = self.s.popup_id("folder")
        self.s.wait_screen(str(first.resolve()))
        self.s.keys("C-z")
        self.wait_closed(str(first.resolve()))
        self.s.slot("alt+1", "--name", "folder", "--toggle-key", "ctrl+z", "-d", str(second),
                    *command)
        self.press_slot("alt+1")
        self.s.wait_screen(str(first.resolve()))
        self.s.text("pwd -P")
        self.s.keys("Enter")
        self.s.wait(lambda: self.s.pane_text(popup_id).count(str(first.resolve())) >= 2,
                    "pwd to print the first folder again")
        self.assertNotIn(str(second.resolve()), self.s.read_pane(popup_id))
        self.s.keys("C-z")
        self.wait_closed(str(first.resolve()))


class ShellPopups:
    """Helpers for tests with shell popups that print `<label>-ready` and hide with ctrl+z."""

    def ready_slot(self, key, label, *flags):
        self.s.slot(key, "--name", label, "--toggle-key", "ctrl+z", *flags, "--",
                    "/bin/sh", "-c", f"echo {label}-ready; exec /bin/sh")

    def show(self, key, label, target="main"):
        """Press a slot key ("alt+1") and wait for the popup."""
        self.s.keys("M-" + key.removeprefix("alt+"), target=target)
        self.s.wait_screen(f"{label}-ready", target=target)

    def hide(self, label, target="main"):
        self.s.keys("C-z", target=target)
        self.s.wait_screen(f"{label}-ready", present=False, target=target)
        self.s.wait_popup_closed(target)

    def mark(self, label, text, target="main"):
        """Make the program of the shown popup print TEXT, so that a test can find it again."""
        self.s.text(f"echo {text}-$((40+2))", target=target)
        self.s.keys("Enter", target=target)
        self.s.wait_screen(f"{text}-42", target=target)

    def workspace(self, label, folder=None):
        """A new focused workspace that closes after the test."""
        workspace_id = self.s.new_workspace(label, folder)
        self.addCleanup(self.close_quietly, "workspace.close", {"workspace_id": workspace_id})
        return workspace_id

    def tab(self, workspace_id, folder=None):
        """A new focused tab that closes after the test."""
        tab_id = self.s.new_tab(workspace_id, folder)
        self.addCleanup(self.close_quietly, "tab.close", {"tab_id": tab_id})
        return tab_id

    def close_quietly(self, method, params):
        # The test can close it first.
        with contextlib.suppress(RuntimeError):
            call(self.s.socket, method, params)

    def labels(self):
        """The sorted labels of the saved popup records."""
        return sorted(record["label"] for record in self.s.records().values())


class Scopes(ShellPopups, StageCase):
    """Where each scope shares a popup, and how Herdr's events close it."""

    def test_a_popup_key_runs_the_homebrew_python3_or_else_python3(self):
        # toggle.sh picks the Python. The popup session's shell script names it.
        s = self.s
        self.workspace("python")  # Its close removes the popup.
        self.ready_slot("alt+1", "python")
        self.show("alt+1", "python")
        self.hide("python")
        shell = s.state_home / "herdr" / "plugins" / "dotfiles.toggle-popup" / "popup-shell"
        python = shlex.split(shell.read_text(encoding="utf-8").splitlines()[-1])[1]
        homebrew = "/opt/homebrew/bin/python3"
        if os.access(homebrew, os.X_OK):
            expected = homebrew
        else:
            # Linux, as in the Docker tests.
            expected = shutil.which("python3", path=s.env["PATH"])
        self.assertEqual(os.path.realpath(python), os.path.realpath(expected))

    def test_tab_scope_gives_each_tab_its_own_popup(self):
        s = self.s
        first = s.focused_tab()
        second = self.tab(self.home)
        self.ready_slot("alt+1", "tabbed", "--scope", "tab")
        self.show("alt+1", "tabbed")
        self.mark("tabbed", "second-tab")
        self.hide("tabbed")
        s.show_tab(first)
        self.show("alt+1", "tabbed")
        self.assertNotIn("second-tab-42", s.screen())
        self.hide("tabbed")
        ids = s.popup_ids("tabbed")
        self.assertEqual(sorted(s.records()[popup_id]["owner"]["tab_id"] for popup_id in ids),
                         sorted([first, second]))

    def test_closing_a_tab_closes_only_its_tab_popups(self):
        s = self.s
        second = self.tab(self.home)
        self.ready_slot("alt+1", "of-tab", "--scope", "tab")
        self.ready_slot("alt+2", "of-workspace")
        for key, label in (("alt+1", "of-tab"), ("alt+2", "of-workspace")):
            self.show(key, label)
            self.hide(label)
        self.assertEqual(self.labels(), ["of-tab", "of-workspace"])
        # Herdr sends tab.closed. No toggle runs, so the hook closes the popup.
        call(s.socket, "tab.close", {"tab_id": second})
        s.wait(lambda: self.labels() == ["of-workspace"], "the tab popup to close")
        self.assertEqual(len(s.popup_panes()), 1)

    def test_workspace_scope_shares_one_popup_between_its_tabs(self):
        s = self.s
        first = s.focused_tab()
        self.tab(self.home)
        self.ready_slot("alt+1", "shared")
        self.show("alt+1", "shared")
        self.mark("shared", "same")
        self.hide("shared")
        s.show_tab(first)
        self.show("alt+1", "shared")
        s.wait_screen("same-42")
        self.hide("shared")
        self.assertEqual(len(s.popup_ids("shared")), 1)
        # Another workspace has its own popup.
        self.workspace("ws-other")
        self.show("alt+1", "shared")
        self.assertNotIn("same-42", s.screen())
        self.hide("shared")
        self.assertEqual(len(s.popup_ids("shared")), 2)

    def test_closing_a_workspace_closes_its_workspace_and_tab_popups(self):
        s = self.s
        other = self.workspace("closing")
        self.tab(other)
        flags = {"in-workspace": (), "in-tab": ("--scope", "tab"),
                 "in-session": ("--scope", "session"), "in-folder": ("--scope", "pwd")}
        for index, (label, scope) in enumerate(flags.items(), start=1):
            self.ready_slot(f"alt+{index}", label, *scope)
            self.show(f"alt+{index}", label)
            self.hide(label)
        self.assertEqual(self.labels(), sorted(flags))
        # Herdr's workspace.close sends workspace.closed, and no tab.closed for its tabs.
        call(s.socket, "workspace.close", {"workspace_id": other})
        s.wait(lambda: self.labels() == ["in-folder", "in-session"],
               "the workspace and tab popups to close")
        self.assertEqual(len(s.popup_panes()), 2)

    def test_pwd_scope_shares_one_popup_per_folder(self):
        s = self.s
        folder = s.root / "proj"
        sub = folder / "src"
        sub.mkdir(parents=True, exist_ok=True)
        self.workspace("proj-a", folder)
        self.ready_slot("alt+1", "git", "--scope", "pwd")
        self.show("alt+1", "git")
        self.mark("git", "proj")
        self.hide("git")
        # Another workspace in the same folder shares the popup.
        second = self.workspace("proj-b", folder)
        self.show("alt+1", "git")
        s.wait_screen("proj-42")
        self.hide("git")
        self.assertEqual(len(s.popup_ids("git")), 1)
        # A subfolder has its own popup.
        self.tab(second, sub)
        self.show("alt+1", "git")
        self.assertNotIn("proj-42", s.screen())
        self.hide("git")
        ids = s.popup_ids("git")
        self.assertEqual(sorted(Path(s.records()[popup_id]["owner"]["folder"]).resolve()
                                for popup_id in ids), sorted([folder.resolve(), sub.resolve()]))

    def test_session_scope_shares_one_popup_between_workspaces(self):
        s = self.s
        self.ready_slot("alt+1", "everywhere", "--scope", "session")
        self.show("alt+1", "everywhere")
        self.mark("everywhere", "one")
        self.hide("everywhere")
        self.workspace("elsewhere")
        self.show("alt+1", "everywhere")
        s.wait_screen("one-42")
        self.hide("everywhere")
        self.assertEqual(len(s.popup_ids("everywhere")), 1)

    def test_without_python3_toggle_sh_shows_a_toast(self):
        # Herdr shows the popup first, and it closes when toggle.sh exits.
        s = self.s
        script = s.root / "no-python-toggle.sh"
        text = harness.TOGGLE_SCRIPT.read_text(encoding="utf-8")
        # Every Mac has /usr/bin/python3, so the copy looks for another name.
        for old, new in (("p=/opt/homebrew/bin/python3", "p=/no-such-folder/python3"),
                         ("command -v python3", "command -v no-such-python3"),
                         ('exec python3 "$0"', 'exec no-such-python3 "$0"')):
            self.assertIn(old, text)
            text = text.replace(old, new)
        script.write_text(text, encoding="utf-8")
        s.slot("alt+1", "--name", "nopython", "--", "/bin/sh", script=script)
        s.keys("M-1")
        toast = "python3 not found: toggle-popup needs Python 3.11+"
        s.wait(lambda: s.screen() and any(toast in seen for seen in s.toasts),
               "the no-python3 toast")
        s.wait_popup_closed()
        self.assertEqual(s.records(), {})

    def test_a_program_that_cannot_start_shows_a_toast(self):
        # Herdr shows the popup first. On an error, the popup closes and the toast shows.
        s = self.s
        s.slot("alt+1", "--name", "missing", "--", "no-such-program-x")
        s.keys("M-1")
        toast = "cannot run no-such-program-x: No such file or directory"
        s.wait(lambda: s.screen() and any(toast in seen for seen in s.toasts),
               "the start error toast")
        s.wait_popup_closed()
        s.wait(lambda: not s.started_popup_panes(), "no backing popup")
        self.assertEqual(s.records(), {})

    def test_a_bad_flag_shows_a_toast(self):
        s = self.s
        s.slot("alt+1", "--scope", "git", "--", "/bin/sh")
        s.keys("M-1")
        s.wait(lambda: s.screen() and any("invalid choice: 'git'" in toast for toast in s.toasts),
               "the usage error toast")
        s.wait_popup_closed()
        self.assertEqual(s.started_popup_panes(), {})


class TwoSessions(ShellPopups, StageCase):
    """A second Herdr session never shares a popup, and each picker lists only its own."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        try:
            cls.other = cls.stage.add_client("other", "tp-e2e-b")
        except BaseException:
            cls.stage.close()
            raise

    def reset(self):
        close_popup(self.other)
        super().reset()
        self.s.wait_popup_closed("other")

    def test_a_second_herdr_session_never_shares_a_popup(self):
        s = self.s
        # Both clients start in the same folder.
        for scope in ("session", "pwd", "workspace"):
            with self.subTest(scope=scope):
                label = f"{scope}-wide"
                self.ready_slot("alt+1", label, "--scope", scope)
                self.show("alt+1", label)
                self.mark(label, "main")
                self.hide(label)
                self.show("alt+1", label, target="other")
                self.assertNotIn("main-42", s.screen("other"))
                self.hide(label, target="other")
                ids = s.popup_ids(label)
                sockets = sorted(s.records()[popup_id]["owner"]["socket"] for popup_id in ids)
                self.assertEqual(sockets, sorted([str(s.socket), str(self.other)]))

    def test_the_picker_groups_the_popups_of_its_session(self):
        s = self.s
        self.ready_slot("alt+1", "theirs", "--scope", "session")
        self.show("alt+1", "theirs", target="other")
        self.hide("theirs", target="other")
        build = self.workspace("build")
        build_tab = self.tab(build)
        self.ready_slot("alt+2", "logs", "--scope", "tab")
        self.show("alt+2", "logs")
        self.hide("logs")
        call(s.socket, "workspace.focus", {"workspace_id": self.home})
        s.wait_tab(next(tab["tab_id"] for tab in s.main_snapshot()["tabs"]
                        if tab["workspace_id"] == self.home))
        self.ready_slot("alt+3", "notes", "--scope", "session")
        self.ready_slot("alt+4", "git", "--scope", "pwd")
        self.ready_slot("alt+5", "shell")
        for key, label in (("alt+3", "notes"), ("alt+4", "git")):
            self.show(key, label)
            self.hide(label)
        self.show("alt+5", "shell")
        s.chord("g")
        s.wait_screen("Switch popup")
        labels = {item["workspace_id"]: item["label"]
                  for item in s.main_snapshot()["workspaces"]}
        tab_label = next(tab["label"] for tab in s.main_snapshot()["tabs"]
                         if tab["tab_id"] == build_tab)
        rows = [row for row in s.popup_lines()[5:-3] if row.strip()]
        # Group titles and rows, with no folder or command columns.
        shape = [re.sub(r"^( {5}\S+| │ › \S+( ●)?).*", r"\1", row) for row in rows]
        self.assertEqual(shape, [
            f"  {s.session} session", "     git", "     notes",
            f"  {labels[self.home]} workspace", " │ › shell ●",
            f"  {labels[build]} workspace", "     logs"])
        self.assertIn(f"tab {tab_label}", rows[-1])
        self.assertIn(Path(s.root).name, rows[1])
        self.assertNotIn("theirs", s.screen())
        s.keys("Escape")
        s.wait_screen("Switch popup", present=False)
        self.hide("shell")


# A theme with one color for each Herdr token. Without herdr-src, as in the
# repo, the plugin gets each token from here.
PAGE_THEME = {token: f"#{index:02x}{(index * 37) % 256:02x}{200 - index:02x}" for index, token in
              enumerate(("accent", "panel_bg", "sidebar_bg", "active_row_bg", "selection_bg",
                         "surface0", "surface1", "surface_dim", "overlay0", "overlay1", "text",
                         "subtext0", "mauve", "green", "yellow", "red", "blue", "teal",
                         "peach"), 1)}


def rgb(color):
    """The (r, g, b) of a #rrggbb color."""
    return tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))


class Pages(ShellPopups, StageCase):
    """The look of the help page and the picker, and the picker's filter."""

    THEME = PAGE_THEME

    def setUp(self):
        super().setUp()
        self.ready_slot("alt+1", "alpha")
        self.ready_slot("alt+2", "beta")
        self.show("alt+2", "beta")
        self.hide("beta")
        self.show("alt+1", "alpha")

    def tearDown(self):
        if self.s.popup_visible():
            self.s.keys("C-z")
            self.s.wait_popup_closed()

    def open_picker(self):
        self.s.chord("g")
        self.s.wait_screen("Switch popup")
        self.s.wait_screen("2 of 2")

    def assert_theme_colors(self, page):
        colors = {rgb(value) for value in PAGE_THEME.values()}
        cells = self.s.popup_cells()
        self.assertTrue(cells)
        # The page is as wide as its rule. Herdr draws the column after it.
        width = len("".join(char for char, _, _ in cells[1]).rstrip(" "))
        self.assertGreater(width, 100)
        cells = [row[:width] for row in cells]
        wrong = {(y, x, char, fg, bg) for y, row in enumerate(cells)
                 for x, (char, fg, bg) in enumerate(row) if fg not in colors or bg not in colors}
        self.assertEqual(wrong, set(), f"colors on the {page} that are no theme token")
        # Most cells have the panel color: the page fills each cell.
        backgrounds = [bg for row in cells for _, _, bg in row]
        self.assertGreater(backgrounds.count(rgb(PAGE_THEME["panel_bg"])), len(backgrounds) // 2)

    def test_every_color_on_the_pages_is_a_theme_token(self):
        s = self.s
        s.chord("?")
        s.wait_screen("alpha popup")
        self.assert_theme_colors("help page")
        s.text("x")
        s.wait_screen("alpha popup", present=False)
        self.open_picker()
        self.assert_theme_colors("picker")
        s.text("%%%")
        s.wait_screen("No popup matches")
        self.assert_theme_colors("picker without a match")
        s.keys("C-c")
        s.wait_screen("Switch popup", present=False)
        s.wait_screen("alpha-ready")

    def test_the_filter_narrows_the_list_and_enter_shows_the_match(self):
        s = self.s
        self.open_picker()
        # The group label is a random folder name: only "beta-ready" has "-" after
        # "beta". The letters match in order: "b" "e" "t" "a" in the label, "-" in the command.
        s.text("beta-")
        s.wait_screen("1 of 2")
        rows = s.popup_lines()
        self.assertEqual(rows[3].strip(), "› beta-")
        self.assertTrue(any(row.startswith(" │ › beta ") for row in rows), rows)
        self.assertFalse(any(" alpha " in row for row in rows), rows)
        s.keys("Enter")
        s.wait_screen("beta-ready")
        self.assertIn(self.s.popup_id("beta"), trace_ids(s, "switch"))

    def test_the_filter_cursor_moves_and_edits_in_place(self):
        s = self.s
        self.open_picker()
        s.text("bta-")
        s.wait_screen("› bta-")
        # Back to after "b", then type the missing "e" there.
        s.keys("Left", "Left", "Left")
        s.text("e")
        s.wait_screen("› beta-")
        # The terminal cursor is after "be", inside the field.
        start = s.popup_lines()[3].index("›") + 2
        self.assertEqual(s.popup_cursor(), (3, start + 2))
        # Home, delete, End, backspace: "eta".
        s.keys("Home", "DC", "End", "BSpace")
        s.wait_screen("› eta ")
        self.assertEqual(s.popup_cursor(), (3, start + 3))

    def test_esc_clears_the_filter_then_keeps_this_popup(self):
        s = self.s
        self.open_picker()
        # j, k and q are filter text now.
        s.text("%jkq")
        s.wait_screen("No popup matches “%jkq”")
        s.wait_screen("0 of 2")
        s.keys("Escape")
        s.wait_screen("2 of 2")
        s.wait_screen("Filter popups")
        s.keys("Escape")
        s.wait_screen("Switch popup", present=False)
        s.wait_screen("alpha-ready")
        self.assertNotIn("beta-ready", s.screen())


class PopupServer(ShellPopups, StageCase):
    """The popup server loads no plugins, and popup programs get the user's environment.

    The main session links the user's other plugins too. They must not act on
    popup panes.
    """

    PLUGINS = (PLUGIN, *(path for path in OTHER_PLUGINS if path.is_dir()))
    # What a popup program prints for each value that the plugin changes for the popup server.
    REPORT = ('printf "xdg=[%s] shell=[%s] config=[%s]\\n" "${XDG_CONFIG_HOME-unset}" '
              '"${SHELL-unset}" "${HERDR_CONFIG_PATH-unset}"')

    def user_values(self):
        env = self.s.env
        return (f"xdg=[{env.get('XDG_CONFIG_HOME', 'unset')}] "
                f"shell=[{env.get('SHELL', 'unset')}] "
                f"config=[{env.get('HERDR_CONFIG_PATH', 'unset')}]")

    def test_the_popup_server_runs_no_plugins(self):
        s = self.s
        self.ready_slot("alt+1", "first")
        self.ready_slot("alt+2", "second", "--scope", "tab")
        for key, label in (("alt+1", "first"), ("alt+2", "second")):
            self.show(key, label)
            self.mark(label, label)
            self.hide(label)
        ids = {s.popup_id("first"), s.popup_id("second")}
        main = {item.get("plugin_id", item.get("id"))
                for item in call(s.socket, "plugin.list")["plugins"]}
        self.assertEqual(len(main), len(self.PLUGINS))
        self.assertEqual(call(s.popup_socket, "plugin.list")["plugins"], [])
        # A plugin that acts on a popup pane logs a command run in the popup server.
        self.assertEqual(call(s.popup_socket, "plugin.log.list", {"limit": 50})["logs"], [])
        # Nothing renamed the backing workspaces: their labels are still the popup ids.
        self.assertEqual(set(s.popup_panes()), ids)
        for popup_id in ids:
            self.assertIsNotNone(s.popup_panes()[popup_id])

    def test_a_command_popup_gets_the_users_environment(self):
        self.s.slot("alt+1", "--name", "env", "--toggle-key", "ctrl+z", "--",
                    "/bin/sh", "-c", f"{self.REPORT}; echo env-ready; exec /bin/sh")
        self.show("alt+1", "env")
        self.s.wait_screen(self.user_values())
        self.hide("env")

    def test_a_default_shell_popup_gets_the_users_environment(self):
        s = self.s
        s.slot("alt+1", "--name", "sh", "--toggle-key", "ctrl+z")
        s.keys("M-1")
        s.wait(lambda: any(row.endswith("$") for row in s.popup_lines()),
               "the prompt of the default shell in the popup")
        s.text(self.REPORT)
        s.keys("Enter")
        s.wait_screen(self.user_values())
        s.keys("C-z")
        s.wait_popup_closed()


    def stray_plugin(self):
        """A tiny plugin folder for `herdr plugin link`. The test unlinks it from both sessions."""
        folder = self.s.root / "stray-plugin"
        folder.mkdir(exist_ok=True)
        (folder / "herdr-plugin.toml").write_text(
            'id = "e2e.stray"\nname = "Stray"\nversion = "1.0.0"\nmin_herdr_version = "0.9.5"\n',
            encoding="utf-8")
        for endpoint in (self.s.socket, self.s.popup_socket):
            self.addCleanup(self.unlink_quietly, endpoint, "e2e.stray")
        return folder

    @staticmethod
    def unlink_quietly(endpoint, plugin_id):
        with contextlib.suppress(RuntimeError, OSError):
            call(endpoint, "plugin.unlink", {"plugin_id": plugin_id})

    @staticmethod
    def workspace_count(endpoint):
        return len(call(endpoint, "session.snapshot")["snapshot"]["workspaces"])

    @staticmethod
    def plugin_ids(endpoint):
        return {item["plugin_id"] for item in call(endpoint, "plugin.list")["plugins"]}

    def test_herdr_commands_in_a_popup_reach_the_owner_session(self):
        s = self.s
        folder = self.stray_plugin()
        out = s.root / "herdr-in-popup.txt"
        s.slot("alt+1", "--name", "sh", "--toggle-key", "ctrl+z")
        s.keys("M-1")
        s.wait(lambda: any(row.endswith("$") for row in s.popup_lines()),
               "the prompt of the default shell in the popup")
        # The same commands as in a normal pane: `chezmoi apply` links plugins this way.
        s.text(f'"$HERDR_BIN_PATH" plugin link {folder} --enabled >/dev/null && '
               f'"$HERDR_BIN_PATH" workspace list > {out} && '
               'printf "env=[%s] pane=[%s] tab=[%s] workspace=[%s] done-%s\\n" '
               '"${HERDR_ENV-unset}" "${HERDR_PANE_ID-unset}" "${HERDR_TAB_ID-unset}" '
               '"${HERDR_WORKSPACE_ID-unset}" "$((40+2))"')
        s.keys("Enter")
        s.wait_screen("env=[1] pane=[unset] tab=[unset] workspace=[unset] done-42")
        s.keys("C-z")
        s.wait_popup_closed()
        self.assertIn("e2e.stray", self.plugin_ids(s.socket))
        self.assertEqual(self.plugin_ids(s.popup_socket), set())
        # Both sessions have a workspace w1: the labels tell them apart.
        def workspaces(items):
            return {(item["workspace_id"], item["label"]) for item in items}

        listed = json.loads(out.read_text(encoding="utf-8"))["result"]["workspaces"]
        self.assertEqual(workspaces(listed), workspaces(s.main_snapshot()["workspaces"]))

    def test_a_plugin_linked_to_the_popup_server_is_unlinked_again(self):
        # Before the fix, `herdr plugin link` in a popup reached the popup server.
        s = self.s
        folder = self.stray_plugin()
        toasts = list(s.toasts)
        self.ready_slot("alt+1", "first")
        self.show("alt+1", "first")
        self.hide("first")
        call(s.popup_socket, "plugin.link", {"path": str(folder), "enabled": True})
        self.assertEqual(self.plugin_ids(s.popup_socket), {"e2e.stray"})
        self.show("alt+1", "first")
        self.hide("first")
        self.assertEqual(self.plugin_ids(s.popup_socket), set())
        self.assertEqual(s.toasts, toasts)

    def test_a_restarted_popup_server_loads_no_plugin_of_the_last_one(self):
        s = self.s
        folder = self.stray_plugin()
        toasts = list(s.toasts)
        self.ready_slot("alt+1", "first")
        self.show("alt+1", "first")
        self.hide("first")
        call(s.popup_socket, "plugin.link", {"path": str(folder), "enabled": True})
        s.herdr("--session", "toggle-popup", "server", "stop")
        wait_for(lambda: not harness.herdr_answers(s.popup_socket), "no popup server")
        self.show("alt+1", "first")
        self.hide("first")
        self.assertEqual(self.plugin_ids(s.popup_socket), set())
        # The new server restores the old popup workspace with an empty shell.
        # The sweep after the toggle closes it, so one workspace is left.
        s.wait(lambda: self.workspace_count(s.popup_socket) == 1,
               "the sweep to close the restored workspace")
        self.assertEqual(s.toasts, toasts)

    def test_a_new_shell_popup_uses_the_current_default_shell(self):
        s = self.s
        # The popup server runs, with the first default shell in the config.
        self.ready_slot("alt+1", "first")
        self.show("alt+1", "first")
        self.hide("first")
        other = s.root / "other-shell.sh"
        other.write_text("#!/bin/sh\nunset ENV\nexport PS1='other-shell$ '\nexec /bin/sh -i\n",
                         encoding="utf-8")
        other.chmod(0o755)
        config = s.main_config.read_text(encoding="utf-8")
        self.addCleanup(s.main_config.write_text, config, encoding="utf-8")
        old = f"default_shell = {json.dumps(str(s.shell()))}"
        self.assertIn(old, config)
        s.main_config.write_text(config.replace(old, f"default_shell = {json.dumps(str(other))}"),
                                 encoding="utf-8")
        s.slot("alt+2", "--name", "later", "--toggle-key", "ctrl+z")
        s.keys("M-2")
        s.wait(lambda: any(row.endswith("other-shell$") for row in s.popup_lines()),
               "the new default shell in the popup")
        s.keys("C-z")
        s.wait_popup_closed()


    def test_a_popup_server_started_by_hand_is_refused(self):
        s = self.s
        # An earlier test can leave the plugin's own popup server running.
        s.herdr("--session", "toggle-popup", "server", "stop", check=False)
        wait_for(lambda: not harness.herdr_answers(s.popup_socket), "no popup server")
        # Herdr's own hint for a missing session is `herdr --session
        # toggle-popup`. That server loads the user's plugins.json.
        server = subprocess.Popen([s.herdr_bin, "--session", "toggle-popup", "server"],
                                  env=s.env, cwd=s.root, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True)

        def stop_server():
            if server.poll() is None:
                server.kill()
                server.wait()

        self.addCleanup(stop_server)
        wait_for(lambda: call(s.popup_socket, "plugin.list")["plugins"],
                 "the popup server started by hand, with the user's plugins")
        self.ready_slot("alt+1", "first")
        s.keys("M-1")
        toast = ("the toggle-popup Herdr session was not started by toggle-popup; "
                 "stop it with: herdr --session toggle-popup server stop")
        s.wait(lambda: s.screen() and any(toast in seen for seen in s.toasts),
               "the toast about the popup server started by hand")
        self.assertEqual(s.popup_panes(), {})
        # The command in the toast stops it. Then the toggle starts its own server.
        s.herdr("--session", "toggle-popup", "server", "stop")
        server.wait(timeout=10)
        self.show("alt+1", "first")
        self.hide("first")
        self.assertEqual(call(s.popup_socket, "plugin.list")["plugins"], [])


class PopupServerWithoutXdg(PopupServer):
    """The same checks when the user has no XDG_CONFIG_HOME: popup programs must not get one."""

    XDG_CONFIG_HOME = False


class LegacyOuterKeys(Scenarios, StageCase):
    """tmux sends legacy bytes. ctrl+; has no legacy byte, so the prefix is ctrl+a."""

    PREFIX = "ctrl+a"
    EXTENDED_KEYS = "off"


class ExtendedOuterKeys(Scenarios, StageCase):
    """tmux sends CSI u for modified keys, so the user's ctrl+; prefix works."""

    PREFIX = "ctrl+;"
    EXTENDED_KEYS = "always"


class StageCleanup(unittest.TestCase):
    def test_a_stuck_herdr_does_not_stop_the_cleanup(self):
        stage = Stage("cleanup")

        def stuck(*args, check=True):
            raise subprocess.TimeoutExpired(["herdr", *args], 30)

        stage.herdr = stuck
        stage.close()
        self.assertFalse(stage.root.exists())


class StageDiagnostics(unittest.TestCase):
    """A failure message keeps the real failure, whatever state Herdr is in."""

    def setUp(self):
        self.stage = Stage("diagnostics")
        self.addCleanup(self.stage.close)

    def test_a_herdr_that_hangs_or_gives_no_reply_is_no_answer(self):
        for error in (TimeoutError("timed out"), ValueError("Expecting value"),
                      FileNotFoundError("no socket"), RuntimeError("session.snapshot: x")):
            with self.subTest(error=error):
                with mock.patch.object(harness, "call", side_effect=error):
                    # A check must not take a broken popup server for "no popups".
                    with self.assertRaises(type(error)):
                        self.stage.popup_panes()
                    self.assertEqual(self.stage.popup_panes_text(), f"no answer: {error!r}")

    def test_a_screen_without_its_tmux_session_is_an_error(self):
        # The stage did not start: no tmux session, as after a crash of its Herdr client.
        with self.assertRaisesRegex(RuntimeError, "tmux capture-pane"):
            self.stage.screen()
        # So a "popup is gone" check fails at once, and does not pass on an empty screen.
        with self.assertRaisesRegex(RuntimeError, "tmux capture-pane"):
            self.stage.wait_popup_closed()
        with self.assertRaisesRegex(RuntimeError, "tmux capture-pane"):
            self.stage.wait_screen("ready", present=False)
        self.assertIn("--- main screen\nno screen: tmux capture-pane", self.stage.diagnose())

    def test_a_missing_pane_is_an_error_for_a_strict_read(self):
        snapshot = {"snapshot": {"panes": [], "workspaces": [{"label": "p",
                                                              "workspace_id": "w1"}]}}
        with mock.patch.object(harness, "call", return_value=snapshot):
            with self.assertRaisesRegex(RuntimeError, "popup p has no pane"):
                self.stage.read_pane("p")
            # A wait for text in a popup that does not show yet keeps waiting.
            self.assertEqual(self.stage.pane_text("p"), "")

    def test_a_failed_pane_read_is_an_error_for_a_strict_read(self):
        snapshot = {"snapshot": {"panes": [{"workspace_id": "w1", "pane_id": "w1:p1"}],
                                 "workspaces": [{"label": "p", "workspace_id": "w1"}]}}
        failed = RuntimeError("herdr pane read: no such pane")
        with mock.patch.object(harness, "call", return_value=snapshot), \
                mock.patch.object(self.stage, "herdr", side_effect=failed):
            with self.assertRaisesRegex(RuntimeError, "no such pane"):
                self.stage.read_pane("p")

    def test_the_plugin_toasts_on_a_screen_are_kept(self):
        # The parser needs only the toast title and the frame column at its left.
        screen = (f"  ╭● {python_guard.TITLE} ─────╮\n"
                  "  │invalid choice:     │\n  │'git'               │\n"
                  "  ╰────────────────────╯\n")
        with mock.patch.object(self.stage, "tmux", return_value=screen):
            self.stage.screen()
        self.assertEqual(self.stage.toasts, ["main: invalid choice: 'git'"])


def drain_quietly(fd):
    """Read a pseudo-terminal until it closes, so that its writer never blocks."""
    with contextlib.suppress(OSError):
        while os.read(fd, 65536):
            pass


def trace_ids(stage, event):
    """The popup ids with `event` in the proxy event trace."""
    if not stage.trace_path.exists():
        return set()
    lines = stage.trace_path.read_text(encoding="utf-8").splitlines()
    return {line.split("\t")[0] for line in lines if line.endswith(f"\t{event}")}


class OwnerSessions(unittest.TestCase):
    """Popups of a Herdr session that stopped are closed by the next sweep."""

    @classmethod
    def setUpClass(cls):
        cls.stage = Stage("owners")
        try:
            cls.stage.start()
        except BaseException:
            cls.stage.close()
            raise

    @classmethod
    def tearDownClass(cls):
        for session in ("tp-e2e-b", "tp-e2e-c"):
            with contextlib.suppress(subprocess.SubprocessError, OSError):
                cls.stage.herdr("--session", session, "server", "stop", check=False)
        cls.stage.close()

    def headless_popup(self, session, name):
        """Start SESSION without a client and make a popup from it, as a key would."""
        s = self.stage
        server = subprocess.Popen([s.herdr_bin, "--session", session, "server"], env=s.env,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, start_new_session=True)

        def stop_server():
            # A test can fail before it stops the server. Stop it first, so
            # that the wait does not add a timeout to the real failure.
            with contextlib.suppress(subprocess.SubprocessError, OSError):
                s.herdr("--session", session, "server", "stop", check=False)
            try:
                server.wait(10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()

        self.addCleanup(stop_server)
        endpoint = s.session_socket(session)
        wait_for(lambda: call(endpoint, "ping") is not None, f"the {session} server")
        workspace = call(endpoint, "workspace.create", {"cwd": str(s.root)})["workspace"]
        env = dict(s.env, HERDR_SOCKET_PATH=str(endpoint),
                   HERDR_ACTIVE_WORKSPACE_ID=workspace["workspace_id"])
        # No client shows a popup, so the toggle runs in a pseudo-terminal of its own.
        main, terminal = os.openpty()
        toggle = subprocess.Popen(
            [sys.executable, str(PLUGIN / "toggle_popup.py"), "--name", name, "--", "/bin/sh"],
            env=env, stdin=terminal, stdout=terminal, stderr=terminal, start_new_session=True)
        os.close(terminal)
        drain = threading.Thread(target=drain_quietly, args=(main,), daemon=True)
        drain.start()
        try:
            popup_id = s.popup_id(name, endpoint)
            s.wait(lambda: popup_id in trace_ids(s, "open"), "the proxy of the popup")
        finally:
            # Herdr closes a popup with SIGHUP. The program keeps running.
            toggle.send_signal(signal.SIGHUP)
            status = toggle.wait(10)
            drain.join(5)
            os.close(main)
        self.assertEqual(status, 128 + signal.SIGHUP)
        return endpoint, popup_id

    def test_toggle_sweeps_popups_of_a_stopped_session(self):
        s = self.stage
        _, popup_id = self.headless_popup("tp-e2e-b", "lost")
        s.herdr("--session", "tp-e2e-b", "server", "stop")
        s.slot("alt+1", "--name", "here", "--toggle-key", "ctrl+z", "--",
               "/bin/sh", "-c", "echo here-ready; exec /bin/sh")
        s.keys("M-1")
        s.wait_screen("here-ready")
        s.wait(lambda: popup_id not in s.popup_panes(), "the lost popup to close")
        s.keys("C-z")
        s.wait_screen("here-ready", present=False)

    def test_server_start_sweeps_popups_of_a_stopped_session(self):
        s = self.stage
        _, popup_id = self.headless_popup("tp-e2e-c", "lost")
        s.herdr("--session", "tp-e2e-c", "server", "stop")
        self.assertIn(popup_id, s.popup_panes())
        # A server start runs the plugin's startup hook in that new server.
        s.herdr("--session", s.session, "server", "stop")
        # The client ends with its server, and tmux can end with it: no error.
        s.tmux("kill-server", check=False)
        s.start()
        s.wait(lambda: popup_id not in s.popup_panes(), "the startup sweep")


class TwoClients(ShellPopups, StageCase):
    """Two clients of one Herdr session, and other viewers of a popup's terminal.

    Herdr has one popup for each session. Clients on the tab that opened it
    show it together. Another viewer of the same terminal can only be a
    plain `terminal attach` client.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        try:
            cls.stage.add_client("second", cls.stage.session)
        except BaseException:
            cls.stage.close()
            raise

    def reset(self):
        super().reset()
        self.s.wait_popup_closed("second")

    def test_clients_on_the_same_tab_show_the_same_popup(self):
        s = self.s
        self.ready_slot("alt+1", "together")
        self.show("alt+1", "together")
        s.wait_screen("together-ready", target="second")
        # Keys of the second client reach the same program.
        self.mark("together", "second", target="second")
        s.wait_screen("second-42")
        self.hide("together", target="second")
        s.wait_popup_closed()
        self.assertEqual(len(s.popup_ids("together")), 1)

    def test_a_client_on_another_tab_cannot_open_a_second_popup(self):
        s = self.s
        tab = call(s.socket, "tab.create", {"workspace_id": self.home})["tab"]
        tab_id = tab["tab_id"]
        self.addCleanup(self.close_quietly, "tab.close", {"tab_id": tab_id})
        # A client moves only between the tabs that it shows. Wait until the
        # tab bar (the top line) of the second client shows the new tab.
        bar = re.compile(rf"\s{tab['number']}\s")
        s.wait(lambda: bar.search(s.screen("second").splitlines()[0]),
               "the new tab in the tab bar of the second client")
        # Each client has its own focus: the second one moves to the new tab.
        s.keys(s.prefix_keys(), "n", target="second")
        s.wait_tab(tab_id, target="second")
        self.ready_slot("alt+1", "busy")
        self.show("alt+1", "busy")
        self.assertFalse(s.popup_visible("second"))
        toasts = list(s.toasts)
        s.keys("M-1", target="second")
        # Herdr refuses the popup key itself, with its own notice.
        s.wait_screen("Action rejected", target="second")
        s.wait_screen("popup already open", target="second")
        self.assertFalse(s.popup_visible("second"))
        self.assertEqual(s.toasts, toasts)
        self.hide("busy")

    def attach(self, terminal_id, *flags):
        """Start a plain `terminal attach` client in its own pseudo-terminal.

        Return the process. Its screen output collects in `process.screen`.
        """
        s = self.s
        main, terminal = os.openpty()
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        env = {key: value for key, value in s.env.items() if key != "HERDR_CONFIG_PATH"}
        process = subprocess.Popen(
            [s.herdr_bin, "--session", "toggle-popup", "terminal", "attach", terminal_id,
             *flags], env=env, stdin=terminal, stdout=terminal, stderr=subprocess.PIPE,
            text=True, start_new_session=True)
        os.close(terminal)
        process.screen = bytearray()

        def drain():
            try:
                while data := os.read(main, 65536):
                    process.screen += data
            except OSError:
                pass

        thread = threading.Thread(target=drain, daemon=True)
        thread.start()

        def stop():
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=10)
            os.close(main)
            thread.join(5)
        self.addCleanup(stop)
        return process

    def terminal(self, label):
        return self.s.popup_panes()[self.s.popup_id(label)]["terminal_id"]

    def test_herdr_names_a_takeover_as_the_proxy_expects(self):
        # proxy.viewer_end() knows these cases only from Herdr's stderr text.
        s = self.s
        self.ready_slot("alt+1", "raw")
        self.show("alt+1", "raw")
        self.hide("raw")
        terminal_id = self.terminal("raw")
        first = self.attach(terminal_id)
        # The first client shows the terminal when its screen has the program's output.
        s.wait(lambda: b"raw-ready" in first.screen, "the first attach")
        self.attach(terminal_id, "--takeover")
        _, errors = first.communicate(timeout=10)
        self.assertEqual(first.returncode, 1)
        self.assertIn(proxy.ATTACH_TAKEN_OVER, errors)

    def test_a_toggle_takes_the_popup_from_another_viewer(self):
        s = self.s
        self.ready_slot("alt+1", "taken")
        self.show("alt+1", "taken")
        self.hide("taken")
        viewer = self.attach(self.terminal("taken"))
        s.wait(lambda: b"taken-ready" in viewer.screen, "the other viewer")
        self.show("alt+1", "taken")
        _, errors = viewer.communicate(timeout=10)
        self.assertIn(proxy.ATTACH_TAKEN_OVER, errors)
        self.hide("taken")

    def test_a_picker_switch_takes_the_popup_from_another_viewer(self):
        s = self.s
        self.ready_slot("alt+1", "first")
        self.ready_slot("alt+2", "second")
        self.show("alt+2", "second")
        self.hide("second")
        viewer = self.attach(self.terminal("second"))
        s.wait(lambda: b"second-ready" in viewer.screen, "the other viewer")
        self.show("alt+1", "first")
        s.chord("g")
        s.wait_screen("Switch popup")
        s.keys("Down")
        s.keys("Enter")
        s.wait_screen("second-ready")
        _, errors = viewer.communicate(timeout=10)
        self.assertIn(proxy.ATTACH_TAKEN_OVER, errors)
        self.hide("second")


@unittest.skipUnless(sys.platform == "darwin" or os.environ.get("E2E_REAL_BINDS"),
                     "the real binds need nu, yazi, and lazygit-recent")
class RealBinds(StageCase):
    """The binds from home/dot_config/herdr/config.toml, with the real programs."""

    REAL_BINDS = True

    def test_yazi_popup_toggles_with_alt_y(self):
        s = self.s
        (s.root / "yazi-marker-folder").mkdir(exist_ok=True)
        s.keys("M-y")
        s.wait_screen("yazi-marker-folder")
        popup_id = s.popup_id("yazi")
        s.keys("M-y")
        s.wait_popup_closed()
        s.keys("M-y")
        s.wait_screen("yazi-marker-folder")
        # The same key shows the same popup again.
        self.assertEqual(s.popup_ids("yazi"), [popup_id])
        s.keys("M-y")
        s.wait_popup_closed()

    def test_floating_shell_toggles_with_prefix_f(self):
        s = self.s
        s.chord("f")
        # Nushell's prompt shows the start folder.
        s.wait_screen(f"{s.root}>")
        s.text("print floating-ok")
        s.keys("Enter")
        s.wait_pane(s.popup_id("floating"), "floating-ok\n")
        s.chord("f")
        s.wait_popup_closed()
        s.chord("f")
        s.wait_screen("floating-ok")
        s.chord("f")
        s.wait_popup_closed()

    def test_lazygit_popup_is_one_per_pane_folder(self):
        s = self.s
        repo = s.root / "repo"
        (repo / "sub").mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        folders = []
        for label, folder in (("sub", repo / "sub"), ("repo", repo)):
            s.new_workspace(label, folder)
            s.keys("M-g")
            s.wait_screen("Status")
            s.keys("M-g")
            s.wait_popup_closed()
            folders.append(os.path.realpath(folder))
        records = [s.records()[popup_id] for popup_id in s.popup_ids("lazygit")]
        self.assertEqual([record["scope"] for record in records], ["pwd", "pwd"])
        self.assertEqual(sorted(os.path.realpath(record["owner"]["folder"])
                                for record in records), sorted(folders))


REMOTE_CONFIG = """onboarding = false

[keys]
prefix = "ctrl+;"

[[keys.command]]
key = "alt+1"
type = "popup"
width = "80%"
height = "80%"
command = 'exec /bin/sh /plugin/executable_toggle.sh --name remote --toggle-key ctrl+z \
-- python3 /plugin/test/e2e/keylog.py legacy /tmp/remote.log'

[[keys.command]]
key = "alt+2"
type = "popup"
width = "80%"
height = "80%"
command = 'exec /bin/sh /plugin/executable_toggle.sh --name herdr --toggle-key ctrl+z \
-- /bin/sh -c "herdr workspace list > /tmp/remote-herdr.json; \
echo pane=\\${HERDR_PANE_ID-unset} done-\\$((40+2)); exec /bin/sh"'

[[keys.command]]
key = "alt+3"
type = "popup"
width = "80%"
height = "80%"
command = 'exec /bin/sh /plugin/executable_toggle.sh --name login --toggle-key ctrl+z \
-- login-path-program'

[terminal]
default_shell = "/home/tester/remote-shell.sh"

[ui.toast]
delivery = "herdr"
"""
# The remote popup session socket, under the remote user's default config folder.
REMOTE_POPUP_SOCKET = "~/.config/herdr/sessions/toggle-popup/herdr.sock"
# What the remote shell prints when that socket does not exist.
NO_SOCKET = "no-socket"
# Servers from an earlier run may not run: a failed stop is no error here.
REMOTE_SETUP = """set -eu
herdr --session toggle-popup server stop >/dev/null 2>&1 || true
herdr server stop >/dev/null 2>&1 || true
rm -rf ~/.config/herdr ~/.local/state/herdr /tmp/remote.log
mkdir -p ~/.config/herdr
cat > ~/.config/herdr/config.toml
printf '#!/bin/sh\\nexport PS1="REMOTE$ "\\nexec /bin/sh -i\\n' > ~/remote-shell.sh
chmod +x ~/remote-shell.sh
# Debian's ~/.profile puts ~/.local/bin on PATH, but only for a login shell.
mkdir -p ~/.local/bin
printf '#!/bin/sh\necho login-path-$((40+2))\nexec /bin/sh\n' > ~/.local/bin/login-path-program
chmod +x ~/.local/bin/login-path-program
herdr plugin link /plugin --enabled >/dev/null
"""


@unittest.skipUnless(os.environ.get("E2E_REMOTE"), "needs the Docker `remote` service")
class RemoteMachine(StageCase):
    """A popup on a saved SSH machine: its bind, plugin, and programs run there."""

    @classmethod
    def ssh(cls, command, stdin=""):
        result = subprocess.run(["ssh", "-o", "BatchMode=yes", cls.host, command], input=stdin,
                                capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise AssertionError(f"ssh {command!r}: {result.stderr.strip()}")
        return result.stdout

    @classmethod
    def setUpClass(cls):
        cls.host = os.environ["E2E_REMOTE"]
        cls.ssh(REMOTE_SETUP, REMOTE_CONFIG)
        super().setUpClass()
        subprocess.run([cls.stage.herdr_bin, "machine", "add", cls.host], env=cls.stage.env,
                       stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        # Cleanup: a server that already stopped is no error.
        cls.ssh("herdr --session toggle-popup server stop; herdr server stop; true")

    def remote_popups(self):
        """The remote popups by id. Raise when the remote popup session does not answer.

        Only a popup session that never started (no socket file) has no popups.
        Any other reply goes to json.loads, so an empty reply is an error too.
        """
        text = self.ssh(f"[ -e {REMOTE_POPUP_SOCKET} ] || {{ echo {NO_SOCKET}; exit 0; }}\n"
                        "herdr --session toggle-popup workspace list")
        if text.strip() == NO_SOCKET:
            return {}
        return {item["label"]: item for item in json.loads(text)["result"]["workspaces"]}

    def reset(self):
        """Close the remote popups, then the local ones, and show the local workspace again.

        The viewers of the remote popups end, so the client popup closes too.
        """
        for item in self.remote_popups().values():
            self.ssh(f"herdr --session toggle-popup workspace close {item['workspace_id']}")
        self.s.wait(lambda: not self.remote_popups(), "no remote popups")
        # The remote program ended, so the next test starts with an empty log.
        self.ssh("rm -f /tmp/remote.log /tmp/remote-herdr.json")
        super().reset()
        if "REMOTE$" in self.s.screen():
            self.s.wait(self.select_local_workspace, "the local workspace")

    def remote_pane_text(self, popup_id):
        workspace = self.remote_popups()[popup_id]["workspace_id"]
        panes = json.loads(
            self.ssh(f"herdr --session toggle-popup pane list --workspace {workspace}"))
        pane = panes["result"]["panes"][0]["pane_id"]
        return self.ssh(f"herdr --session toggle-popup pane read {pane} --source recent")

    def remote_logged(self):
        # No log yet is a valid state: the program did not start. A failed read is an error.
        text = self.ssh("[ -e /tmp/remote.log ] || exit 0\ncat /tmp/remote.log")
        return bytes.fromhex("".join(text.split()))

    def select_workspace(self, remote):
        """Move to the next workspace down (remote) or up (local) in Herdr's workspace nav.

        The sidebar lists the local workspace first, then the remote one. The
        nav skips the remote workspace until it connects. Return False when
        the workspace did not show.
        """
        s = self.s
        s.chord("w")
        s.wait_screen("NAVIGATE")
        s.keys("Down" if remote else "Up", "Enter")
        try:
            wait_for(lambda: ("REMOTE$" in s.screen()) == remote,
                     "the remote shell" if remote else "the local workspace", timeout=2)
        except AssertionError:
            return False
        return True

    def select_remote_workspace(self):
        return self.select_workspace(remote=True)

    def select_local_workspace(self):
        return self.select_workspace(remote=False)

    def test_remote_popup_runs_on_the_remote_machine(self):
        s = self.s
        s.wait_screen(f" {self.host} ", what="the remote machine in the sidebar")
        s.wait(self.select_remote_workspace, "a remote workspace")
        s.keys("M-1")
        s.wait_screen("keylog legacy ready")
        popup_id = s.wait(lambda: next(iter(self.remote_popups()), None), "the remote popup")
        self.assertRegex(popup_id, "^[0-9a-f]{6}$")
        self.assertEqual(s.started_popup_panes(), {}, "the client machine must not run the popup")
        # One key, so the program reads it in one piece.
        s.text("x")
        s.wait(lambda: self.remote_logged() == b"x", "the key at the remote program")
        self.assertIn("got b'x'", self.remote_pane_text(popup_id))
        s.keys("C-z")
        s.wait_popup_closed()
        self.assertIn(popup_id, self.remote_popups())
        s.keys("M-1")
        s.wait_screen("got b'x'")
        s.chord("q")
        s.wait_popup_closed()
        s.wait(lambda: popup_id not in self.remote_popups(), "the remote popup to close")

    def test_herdr_commands_in_a_remote_popup_reach_the_remote_session(self):
        s = self.s
        s.wait_screen(f" {self.host} ", what="the remote machine in the sidebar")
        s.wait(self.select_remote_workspace, "a remote workspace")
        s.keys("M-2")
        s.wait_screen("pane=unset done-42")
        s.keys("C-z")
        s.wait_popup_closed()

        def workspaces(text):
            return {(item["workspace_id"], item["label"])
                    for item in json.loads(text)["result"]["workspaces"]}

        listed = workspaces(self.ssh("cat /tmp/remote-herdr.json"))
        self.assertEqual(listed, workspaces(self.ssh("herdr workspace list")))
        self.assertNotIn(next(iter(self.remote_popups())), {label for _, label in listed})

    def test_a_remote_popup_finds_programs_on_the_login_path(self):
        # A popup bind runs `/bin/sh -c`, not a login shell. toggle.sh reads
        # the login profile, as a shell bind (`/bin/sh -lc`) does.
        s = self.s
        s.wait_screen(f" {self.host} ", what="the remote machine in the sidebar")
        s.wait(self.select_remote_workspace, "a remote workspace")
        s.keys("M-3")
        s.wait_screen("login-path-42")
        s.keys("C-z")
        s.wait_popup_closed()

    def test_one_key_keeps_a_popup_on_each_machine(self):
        # The same key is bound on both machines, as with one dotfiles repo.
        # Each machine runs the bind of the workspace that shows.
        s = self.s
        log = s.root / "local.log"
        s.slot("alt+1", "--name", "local", "--toggle-key", "ctrl+z", "--",
               *s.keylog_command("legacy", log))
        s.wait_screen(f" {self.host} ", what="the remote machine in the sidebar")
        # 1. A local workspace: the popup runs in this machine's popup session.
        s.keys("M-1")
        s.wait_screen("keylog legacy ready")
        local_id = s.wait(lambda: next(iter(s.started_popup_panes()), None), "the local popup")
        self.assertEqual(self.remote_popups(), {})
        s.text("a")
        s.wait_screen("got b'a'")
        # 2. Its toggle key hides it. It keeps running.
        s.keys("C-z")
        s.wait_popup_closed()
        self.assertEqual(list(s.popup_panes()), [local_id])
        # 3. A remote workspace: the same key opens a popup on the remote machine.
        s.wait(self.select_remote_workspace, "a remote workspace")
        s.keys("M-1")
        s.wait_screen("keylog legacy ready")
        remote_id = s.wait(lambda: next(iter(self.remote_popups()), None), "the remote popup")
        self.assertEqual(list(s.popup_panes()), [local_id])
        # 4. Each machine keeps its own popup.
        s.text("b")
        s.wait(lambda: self.remote_logged() == b"b", "the key at the remote program")
        s.wait_screen("got b'b'")
        s.keys("C-z")
        s.wait_popup_closed()
        self.assertEqual(list(self.remote_popups()), [remote_id])
        self.assertEqual(list(s.popup_panes()), [local_id])
        # 5. The remote picker lists only the remote machine's popups.
        s.keys("M-1")
        s.wait_screen("got b'b'")
        s.chord("g")
        s.wait_screen("Switch popup")
        rows = s.popup_lines()
        self.assertTrue(any("› remote ●" in row for row in rows), rows)
        self.assertFalse(any("local" in row for row in rows), rows)
        s.keys("Escape")
        s.wait_screen("Switch popup", present=False)
        s.wait_screen("got b'b'")
        s.keys("C-z")
        s.wait_popup_closed()
        # 6. Back in the local workspace, the key shows the same local popup.
        s.wait(self.select_local_workspace, "the local workspace")
        s.keys("M-1")
        s.wait_screen("got b'a'")
        self.assertNotIn("got b'b'", s.screen())
        self.assertEqual(list(s.popup_panes()), [local_id])
        # 7. prefix q kills the popup that shows, on its own machine only.
        s.chord("q")
        s.wait_popup_closed()
        s.wait(lambda: not s.popup_panes(), "the local popup to close")
        self.assertEqual(list(self.remote_popups()), [remote_id])
        s.wait(self.select_remote_workspace, "a remote workspace")
        s.keys("M-1")
        s.wait_screen("got b'b'")
        s.chord("q")
        s.wait_popup_closed()
        s.wait(lambda: not self.remote_popups(), "the remote popup to close")
        self.assertEqual(s.popup_panes(), {})


if __name__ == "__main__":
    unittest.main()
