"""The scrollback editor: its pane in the popup session, its file, and its ends."""

import contextlib
import json
import os
import pathlib
import pty
import select
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import herdr_api
import launch
import popups
import scrollback
from fakes import FakePopupSession
from popups import Owner, PopupRecord

SCRIPT = pathlib.Path(scrollback.__file__).resolve()
PROGRAM = "w1:p2"


def patch(case, patcher):
    patcher.start()
    case.addCleanup(patcher.stop)


def wait_until(probe, what, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not probe():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(0.01)


class StateCase(unittest.TestCase):
    """A plugin state folder, and a popup session where popup "p" (workspace w1) runs."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(self.folder / "state")))
        self.session = FakePopupSession()
        self.add_popup("p", "w1")

    def add_popup(self, popup_id, workspace_id):
        self.session.add(workspace_id, popup_id)
        popups.save_record(PopupRecord(popup_id, "session", popup_id, f"term-{workspace_id}",
                                       None, ["ctrl+z"], Owner("/x/main.sock")))

    def live(self, popup_id="p"):
        return popups.live_popups(self.session.snapshot())[popup_id]

    def editor_file(self, popup_id="p"):
        path = popups.scrollback_folder() / f"{popup_id}-abc.txt"
        path.write_text("secret\n")
        return path


class EditorPanes(StateCase):
    """live_popups(): the program's pane and the editor's pane of a popup."""

    def test_the_program_is_the_pane_of_the_records_terminal(self):
        self.session.add_editor("w1")
        snapshot = self.session.snapshot()
        snapshot["panes"].reverse()
        popup = popups.live_popups(snapshot)["p"]
        self.assertEqual(popup.pane["terminal_id"], "term-w1")
        self.assertEqual(popup.editor["terminal_id"], "term-w1-editor")

    def test_a_popup_without_an_editor_has_none(self):
        self.assertIsNone(self.live().editor)

    def test_a_workspace_whose_program_exited_is_no_popup(self):
        # The program's pane closed; the editor's pane ends a moment later.
        self.session.add_editor("w1")
        snapshot = self.session.snapshot()
        snapshot["panes"] = [pane for pane in snapshot["panes"] if pane["terminal_id"] != "term-w1"]
        self.assertEqual(popups.live_popups(snapshot), {})


class EditorFiles(StateCase):
    """The sweep removes scrollback files that no open editor uses."""

    def test_the_file_of_a_popup_without_an_editor_goes(self):
        path = self.editor_file()
        popups.sweep(self.session)
        self.assertFalse(path.exists())

    def test_the_file_of_an_open_editor_stays(self):
        self.session.add_editor("w1")
        path = self.editor_file()
        popups.sweep(self.session)
        self.assertTrue(path.exists())

    def test_the_file_of_a_popup_that_is_gone_goes(self):
        path = self.editor_file("gone")
        popups.sweep(self.session)
        self.assertFalse(path.exists())

    def test_a_workspace_with_only_an_editor_closes(self):
        # The program exited and its editor did not end: the sweep closes both.
        self.session.add_editor("w1")
        self.session.workspaces["w1"]["terminal_id"] = "term-other"
        popups.sweep(self.session)
        self.assertEqual(self.session.closed, ["w1"])

    def test_only_the_user_can_read_the_folder(self):
        self.assertEqual(stat.S_IMODE(popups.scrollback_folder().stat().st_mode), 0o700)


class OpenEditor(StateCase):
    """open_editor(): the file and the editor's tab in the popup's workspace."""

    def setUp(self):
        super().setUp()
        self.reads = []

        def read(pane_id):
            self.reads.append(pane_id)
            return "secret\n"

        patch(self, mock.patch.object(scrollback, "read_scrollback", read))

    def files(self):
        return sorted(popups.scrollback_folder().iterdir())

    def test_the_editor_runs_in_a_second_tab_with_the_file(self):
        held = []
        real_lock = popups.popup_lock

        @contextlib.contextmanager
        def lock():
            with real_lock():
                held.append(True)
                yield
                held.append(False)

        patch(self, mock.patch.object(popups, "popup_lock", lock))
        scrollback.open_editor(self.session, self.live(),
                               {"EDITOR": "nvim", "TOGGLE_POPUP_EDITOR": ""})
        self.assertEqual(self.reads, ["w1:p1"])
        self.assertEqual(held, [True, False])
        [path] = self.files()
        self.assertTrue(path.name.startswith("p-"))
        self.assertEqual(path.read_text(), "secret\n")
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        [root] = self.session.layouts
        self.assertEqual(root["command"], [sys.executable, str(scrollback.LAUNCHER),
                                           sys.executable, str(SCRIPT), str(path)])
        self.assertEqual(root["cwd"], "/work")
        env = root["env"]
        self.assertEqual({name: env[name] for name in (
            scrollback.COMMAND_ENV, scrollback.EDITOR_VALUES_ENV, scrollback.PROGRAM_PANE_ENV,
            scrollback.POPUP_SOCKET_ENV, launch.OWNER_SOCKET_ENV)}, {
            # "secret\n" has one line: the editor opens on line 1.
            scrollback.COMMAND_ENV: f"nvim +1 {path}",
            # The proxy's values: the editor's pane sets them, or removes them when empty.
            scrollback.EDITOR_VALUES_ENV: json.dumps(
                {"EDITOR": "nvim", scrollback.TEMPLATE_ENV: None}),
            scrollback.PROGRAM_PANE_ENV: "w1:p1",
            scrollback.POPUP_SOCKET_ENV: self.session.endpoint,
            launch.OWNER_SOCKET_ENV: "/x/main.sock"})
        self.assertEqual(self.live().editor["terminal_id"], "term-w1-editor")

    def test_the_template_of_the_proxy_reaches_the_pane(self):
        scrollback.open_editor(self.session, self.live(),
                               {"TOGGLE_POPUP_EDITOR": "hx {file}:{line}"})
        [path] = self.files()
        env = self.session.layouts[0]["env"]
        self.assertEqual(env[scrollback.COMMAND_ENV], f"hx {path}:1")
        self.assertEqual(json.loads(env[scrollback.EDITOR_VALUES_ENV]),
                         {"EDITOR": None, scrollback.TEMPLATE_ENV: "hx {file}:{line}"})

    def test_a_popup_with_an_editor_keeps_it(self):
        self.session.add_editor("w1")
        scrollback.open_editor(self.session, self.live(), {"EDITOR": "vi"})
        self.assertEqual((self.session.layouts, self.files()), ([], []))

    def test_a_failed_start_leaves_no_file_and_no_tab(self):
        self.session.start_error = "cannot run python3: No such file or directory"
        with self.assertRaisesRegex(herdr_api.HerdrError, "cannot run python3"):
            scrollback.open_editor(self.session, self.live(), {"EDITOR": "vi"})
        self.assertEqual(self.files(), [])
        self.assertEqual(self.session.closed_tabs, ["w1:t6"])
        self.assertIsNone(self.live().editor)

    def test_a_failed_read_leaves_no_file(self):
        def fail(pane_id):
            raise herdr_api.HerdrError("pane read: no such pane")

        patch(self, mock.patch.object(scrollback, "read_scrollback", fail))
        with self.assertRaisesRegex(herdr_api.HerdrError, "no such pane"):
            scrollback.open_editor(self.session, self.live(), {"EDITOR": "vi"})
        self.assertEqual((self.session.layouts, self.files()), ([], []))


class EditorCommand(unittest.TestCase):
    """editor_command(): the shell command of the editor, on the last line of its file.

    Each test runs the command with /bin/sh. The editor is a stand-in that
    prints its arguments.
    """

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        self.args = self.folder / "args"
        script = self.folder / "show-args"
        script.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$@\" > {self.args}\n")
        script.chmod(0o700)
        self.editor = str(script)
        self.path = str(self.folder / "p-abc.txt")

    def run_editor(self, env, path=None, line=42):
        command = scrollback.editor_command(path or self.path, line, env)
        subprocess.run(["/bin/sh", "-c", command], check=True,
                       env=dict(os.environ, PATH=f"{self.folder}:{os.environ['PATH']}"))
        return self.args.read_text().splitlines()

    def test_editor_gets_the_line_then_the_file(self):
        self.assertEqual(self.run_editor({"EDITOR": self.editor}), ["+42", self.path])

    def test_without_editor_vi_runs(self):
        (self.folder / "vi").symlink_to(self.editor)
        for env in ({}, {"EDITOR": ""}, {"EDITOR": "  "}):
            with self.subTest(env=env):
                self.assertEqual(self.run_editor(env), ["+42", self.path])

    def test_editor_can_hold_flags(self):
        self.assertEqual(self.run_editor({"EDITOR": f"{self.editor} -u NONE"}),
                         ["-u", "NONE", "+42", self.path])

    def test_a_template_replaces_editor(self):
        env = {"EDITOR": "nvim", "TOGGLE_POPUP_EDITOR": f"{self.editor} --goto {{file}}:{{line}}"}
        self.assertEqual(self.run_editor(env), ["--goto", f"{self.path}:42"])

    def test_a_template_without_file_gets_the_file_at_its_end(self):
        env = {"TOGGLE_POPUP_EDITOR": f"{self.editor} -l {{line}} --wait"}
        self.assertEqual(self.run_editor(env), ["-l", "42", "--wait", self.path])

    def test_a_template_without_line_gets_no_line_number(self):
        env = {"TOGGLE_POPUP_EDITOR": f"{self.editor} --wait {{file}}"}
        self.assertEqual(self.run_editor(env), ["--wait", self.path])

    def test_an_empty_template_does_not_count(self):
        env = {"EDITOR": self.editor, "TOGGLE_POPUP_EDITOR": ""}
        self.assertEqual(self.run_editor(env), ["+42", self.path])

    def test_a_path_with_spaces_and_quotes_stays_one_argument(self):
        path = str(self.folder / "it's a \"file\" $HOME {line}.txt")
        self.assertEqual(self.run_editor({"EDITOR": self.editor}, path), ["+42", path])
        env = {"TOGGLE_POPUP_EDITOR": f"{self.editor} {{file}}:{{line}}"}
        self.assertEqual(self.run_editor(env, path), [f"{path}:42"])

    def test_the_last_line(self):
        for text, line in (("", 1), ("\n", 1), ("a", 1), ("a\n", 1), ("a\nb", 2),
                           ("a\nb\n", 2), ("a\n\n", 2), ("a\x0cb\u2028c\n", 1)):
            with self.subTest(text=text):
                self.assertEqual(scrollback.last_line(text), line)


class ReadScrollback(unittest.TestCase):
    def test_bytes_that_are_not_utf8_become_replacement_characters(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        herdr = pathlib.Path(folder.name) / "herdr"
        herdr.write_text("#!/bin/sh\nprintf 'ok \\377\\376 \\303\\251\\n'\n")
        herdr.chmod(herdr.stat().st_mode | stat.S_IXUSR)
        patch(self, mock.patch.dict(os.environ, HERDR_BIN_PATH=str(herdr)))
        self.assertEqual(scrollback.read_scrollback("w1:p1"), "ok �� é\n")


class FakePopupServer:
    """A popup server socket for the editor's pane: pane.get and events.subscribe.

    `program_runs` is the answer of pane.get for the program. A test sends
    events to each subscriber with send_event(), or closes them all with
    stop(), as a server that ends. Clients wait in the queue until start().
    """

    def __init__(self, path):
        self.path = path
        self.program_runs = True
        self.subscribers = []
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(path)
        self.server.listen(8)

    def start(self):
        # After the fork of the editor's pane: a fork copies only the thread that calls it.
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            line = client.makefile("rb").readline()
            request = json.loads(line)
            if request["method"] == "events.subscribe":
                self.subscribers.append(client)
                client.sendall(b'{"id":"x","result":{"type":"subscription_started"}}\n')
                continue
            if request["method"] == "pane.get" and self.program_runs:
                reply = {"id": "x", "result": {"pane": {"pane_id": PROGRAM}}}
            else:
                reply = {"id": "x", "error": {"code": "pane_not_found", "message": "gone"}}
            with client:
                client.sendall(json.dumps(reply).encode() + b"\n")

    def send_event(self, event, pane_id):
        line = json.dumps({"event": event, "data": {"type": event, "pane_id": pane_id}})
        for client in self.subscribers:
            client.sendall(line.encode() + b"\n")

    def stop(self):
        self.server.close()
        for client in self.subscribers:
            with contextlib.suppress(OSError):
                client.shutdown(socket.SHUT_RDWR)
            client.close()


class EditorPane(unittest.TestCase):
    """scrollback.py FILE: the editor's pane, in a terminal of its own.

    The stand-in editor notes its arguments, its EDITOR and
    TOGGLE_POPUP_EDITOR, and each SIGHUP and SIGINT. It stays while the file
    `stay` exists, else it ends with status 3.
    """

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        # A short folder: a Unix socket path must stay below 104 bytes on macOS.
        self.folder = pathlib.Path(folder.name)
        self.server = FakePopupServer(str(self.folder / "s.sock"))
        self.addCleanup(self.server.stop)
        self.editor = self.folder / "editor"
        self.editor.write_text(f"""#!/bin/sh
exec 2>/dev/null
trap 'echo HUP >> {self.folder}/signals; exit 0' HUP
trap 'echo INT >> {self.folder}/signals' INT
echo "$#|$*|${{EDITOR-unset}}|${{TOGGLE_POPUP_EDITOR-unset}}" > {self.folder}/args.tmp
mv {self.folder}/args.tmp {self.folder}/args
[ -f {self.folder}/stay ] || exit 3
while :; do sleep 0.05; done
""")
        self.editor.chmod(0o700)
        self.file = self.folder / "p-abc.txt"
        self.file.write_text("secret\n")
        self.pid = None

    def start(self, command=None, values=None, stay=True, env=None):
        """Run the editor's pane in a new terminal. Return the terminal's main fd.

        `command` is the shell command of the editor, and `values` the
        proxy's EDITOR and TOGGLE_POPUP_EDITOR, as open_editor() gives them.
        """
        if stay:
            (self.folder / "stay").write_text("")
        if values is None:
            values = {"EDITOR": str(self.editor), scrollback.TEMPLATE_ENV: None}
        values = dict(os.environ, **{
            scrollback.COMMAND_ENV: command or f"{self.editor} {self.file}",
            scrollback.EDITOR_VALUES_ENV: json.dumps(values),
            scrollback.PROGRAM_PANE_ENV: PROGRAM,
            scrollback.POPUP_SOCKET_ENV: self.server.path, "PYTHONDONTWRITEBYTECODE": "1",
            **(env or {})})
        self.pid, self.terminal = pty.fork()
        if self.pid == 0:
            try:
                os.execve(sys.executable, [sys.executable, "-I", str(SCRIPT), str(self.file)],
                          values)
            finally:
                os._exit(127)
        self.addCleanup(self.kill)
        self.server.start()
        self.output = b""
        return self.terminal

    def kill(self):
        if self.pid is not None:
            # A hang-up stops the editor too. The terminal is read meanwhile:
            # on macOS a process that ends waits until its terminal output is read.
            with contextlib.suppress(ProcessLookupError):
                os.kill(self.pid, signal.SIGHUP)
            with contextlib.suppress(AssertionError):
                self.wait_status()
        if self.pid is not None:
            os.kill(self.pid, signal.SIGKILL)
            self.wait_status()
        os.close(self.terminal)

    def wait_status(self, timeout=5.0):
        """The exit status of the editor's pane. Read its terminal meanwhile."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.pid = None
                return os.waitstatus_to_exitcode(status)
            ready, _, _ = select.select([self.terminal], [], [], 0.02)
            if ready:
                with contextlib.suppress(OSError):
                    self.output += os.read(self.terminal, 4096)
        raise AssertionError(f"the editor's pane did not end; output: {self.output!r}")

    def note(self, name):
        path = self.folder / name
        return path.read_text() if path.exists() else ""

    def wait_editor(self):
        wait_until(lambda: self.note("args"), "the editor to start")

    def test_the_pane_runs_the_command_and_its_end_removes_the_file(self):
        self.start(command=f"{self.editor} +1 '{self.file}'", stay=False)
        self.assertEqual(self.wait_status(), 3)
        self.assertEqual(self.note("args"), f"2|+1 {self.file}|{self.editor}|unset\n")
        self.assertFalse(self.file.exists())

    def test_the_proxy_values_replace_those_of_the_pane(self):
        self.start(values={"EDITOR": None, scrollback.TEMPLATE_ENV: "ed {file}"}, stay=False,
                   env={"EDITOR": "stale", scrollback.TEMPLATE_ENV: "stale"})
        self.assertEqual(self.wait_status(), 3)
        self.assertEqual(self.note("args"), f"1|{self.file}|unset|ed {{file}}\n")

    def test_the_program_exit_stops_the_editor(self):
        self.start()
        self.wait_editor()
        # An event of another pane does nothing.
        self.server.send_event("pane_exited", "w9:p1")
        time.sleep(0.2)
        self.assertTrue(self.file.exists())
        self.server.send_event("pane_exited", PROGRAM)
        self.assertEqual(self.wait_status(), 0)
        self.assertEqual(self.note("signals"), "HUP\n")
        self.assertFalse(self.file.exists())

    def test_a_closed_program_pane_stops_the_editor(self):
        self.start()
        self.wait_editor()
        self.server.send_event("pane_closed", PROGRAM)
        self.wait_status()
        self.assertEqual(self.note("signals"), "HUP\n")
        self.assertFalse(self.file.exists())

    def test_a_popup_server_that_ends_stops_the_editor(self):
        self.start()
        self.wait_editor()
        self.server.stop()
        self.wait_status()
        self.assertEqual(self.note("signals"), "HUP\n")
        self.assertFalse(self.file.exists())

    def test_a_program_that_is_gone_already_runs_no_editor(self):
        self.server.program_runs = False
        self.start()
        self.assertEqual(self.wait_status(), 0)
        self.assertEqual(self.note("args"), "")
        self.assertFalse(self.file.exists())

    def test_a_closed_pane_removes_the_file_and_hangs_up_the_editor(self):
        # Herdr closes the pane with SIGHUP, then SIGTERM, to the pane's process.
        self.start()
        self.wait_editor()
        os.kill(self.pid, signal.SIGHUP)
        os.kill(self.pid, signal.SIGTERM)
        self.wait_status()
        self.assertEqual(self.note("signals"), "HUP\n")
        self.assertFalse(self.file.exists())

    def test_terminal_signals_reach_only_the_editor(self):
        terminal = self.start()
        self.wait_editor()
        # ctrl+c in the terminal's cooked mode: SIGINT to its foreground process group.
        os.write(terminal, b"\x03")
        wait_until(lambda: self.note("signals") == "INT\n", "the editor to get SIGINT")
        self.assertIsNone(os.waitpid(self.pid, os.WNOHANG)[0] or None)
        self.assertTrue(self.file.exists())


class EditorStop(unittest.TestCase):
    def test_an_editor_that_ignores_sighup_is_killed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "file"
            path.write_text("")
            editor = pathlib.Path(folder) / "editor"
            editor.write_text("#!/bin/sh\ntrap '' HUP\nwhile :; do sleep 0.05; done\n")
            editor.chmod(0o700)
            process = scrollback.EditorProcess(f"{editor} {path}")
            time.sleep(0.2)
            start = time.monotonic()
            process.stop(seconds=0.3)
            self.assertLess(time.monotonic() - start, 2.0)
            self.assertIsNotNone(process.status)
            wait_until(lambda: not process._group_alive(), "the editor to end")


if __name__ == "__main__":
    unittest.main()
