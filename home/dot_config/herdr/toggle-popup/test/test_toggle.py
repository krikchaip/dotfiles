"""Flag parsing, popup ids and labels, config reading, and errors of the toggle script."""

import contextlib
import fcntl
import io
import json
import os
import pathlib
import select
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import herdr_api
import herdr_config
import images
import keys
import launch
import popups
import proxy
import toggle_popup
from fakes import FakeOwners, FakePopupSession, FakeServerProcess
from herdr_api import HerdrError
from herdr_config import HerdrConfig
from popups import Owner, PopupRecord
from toggle_popup import UsageError, parse_args, popup_identity, popup_label

ENV = {
    "HERDR_SOCKET_PATH": "/home/u/.config/herdr/sessions/work/herdr.sock",
    "HERDR_ACTIVE_WORKSPACE_ID": "w3",
    "HERDR_ACTIVE_TAB_ID": "w3:t2",
    "HERDR_ACTIVE_PANE_ID": "w3:p7",
    "HERDR_ACTIVE_PANE_CWD": "/home/u/proj/shop",
}
SOCKET = ENV["HERDR_SOCKET_PATH"]


class Flags(unittest.TestCase):
    def test_full_bind_from_the_spec(self):
        options = parse_args(["--name", "floating", "--toggle-key", "prefix+f",
                              "--toggle-key", "ctrl+z", "-d", "/tmp/x", "--", "nu"])
        self.assertEqual(options.name, "floating")
        self.assertEqual(options.scope, "workspace")
        self.assertEqual(options.toggle_keys, ["prefix+f", "ctrl+z"])
        self.assertEqual(options.directory, "/tmp/x")
        self.assertEqual(options.command, ["nu"])

    def test_equals_form_scope_and_command_arguments(self):
        options = parse_args(["--scope=pwd", "--", "lazygit", "-p", "--", "x"])
        self.assertEqual(options.scope, "pwd")
        self.assertEqual(options.command, ["lazygit", "-p", "--", "x"])

    def test_the_bind_sets_the_size_not_a_flag(self):
        for argv in (["-w", "80%"], ["-h", "80%"]):
            with self.subTest(argv=argv):
                with self.assertRaisesRegex(UsageError, "unrecognized arguments"):
                    parse_args(argv)

    def test_no_command_means_the_default_shell(self):
        self.assertIsNone(parse_args(["--name", "x"]).command)

    def test_no_flag_is_required(self):
        options = parse_args([])
        self.assertEqual((options.name, options.scope, options.toggle_keys, options.command),
                         (None, "workspace", [], None))

    def test_every_scope_is_accepted(self):
        for scope in ("tab", "workspace", "pwd", "session"):
            with self.subTest(scope=scope):
                self.assertEqual(parse_args(["--scope", scope]).scope, scope)

    def test_bad_values_are_usage_errors(self):
        for argv in (["--toggle-key", "ctrl+nope"], ["--bogus"], ["--name", ""], ["--"],
                     ["--scope", "git"], ["--id", "x"]):
            with self.subTest(argv=argv):
                with self.assertRaises(UsageError):
                    parse_args(argv)


def identity(*argv, env=ENV):
    return popup_identity(parse_args(list(argv)), env)


class PopupIdentity(unittest.TestCase):
    """The popup id: a hash of the scope key, the command, and the sorted toggle keys."""

    def test_the_id_is_six_hex_characters(self):
        popup_id, _ = identity("--", "nu")
        self.assertRegex(popup_id, r"^[0-9a-f]{6}$")

    def test_each_scope_has_its_owner(self):
        cases = {
            "tab": Owner(SOCKET, workspace_id="w3", tab_id="w3:t2"),
            "workspace": Owner(SOCKET, workspace_id="w3"),
            "pwd": Owner(SOCKET, folder="/home/u/proj/shop"),
            "session": Owner(SOCKET),
        }
        for scope, owner in cases.items():
            with self.subTest(scope=scope):
                self.assertEqual(identity("--scope", scope)[1], owner)

    def test_each_scope_shares_where_its_key_is_the_same(self):
        # (scope, an environment change that keeps the popup, one that makes another)
        cases = [
            ("tab", {"HERDR_ACTIVE_PANE_ID": "w3:p8", "HERDR_ACTIVE_PANE_CWD": "/x"},
             {"HERDR_ACTIVE_TAB_ID": "w3:t3"}),
            ("workspace", {"HERDR_ACTIVE_TAB_ID": "w3:t3", "HERDR_ACTIVE_PANE_CWD": "/x"},
             {"HERDR_ACTIVE_WORKSPACE_ID": "w4", "HERDR_ACTIVE_TAB_ID": "w4:t1"}),
            ("pwd", {"HERDR_ACTIVE_WORKSPACE_ID": "w4", "HERDR_ACTIVE_TAB_ID": "w4:t1"},
             {"HERDR_ACTIVE_PANE_CWD": "/home/u/proj/shop/src"}),
            ("session", {"HERDR_ACTIVE_WORKSPACE_ID": "w4", "HERDR_ACTIVE_TAB_ID": "w4:t1",
                         "HERDR_ACTIVE_PANE_CWD": "/x"}, {}),
        ]
        for scope, same, other in cases:
            with self.subTest(scope=scope):
                first, _ = identity("--scope", scope, "--", "nu")
                self.assertEqual(identity("--scope", scope, "--", "nu",
                                          env=dict(ENV, **same))[0], first)
                if other:
                    self.assertNotEqual(identity("--scope", scope, "--", "nu",
                                                 env=dict(ENV, **other))[0], first)

    def test_no_popup_is_shared_between_herdr_sessions(self):
        personal = dict(ENV, HERDR_SOCKET_PATH="/home/u/.config/herdr/sessions/personal/herdr.sock")
        for scope in ("tab", "workspace", "pwd", "session"):
            with self.subTest(scope=scope):
                self.assertNotEqual(identity("--scope", scope, env=personal)[0],
                                    identity("--scope", scope)[0])

    def test_a_folder_with_a_trailing_slash_is_the_same_folder(self):
        env = dict(ENV, HERDR_ACTIVE_PANE_CWD="/home/u/proj/shop/")
        self.assertEqual(identity("--scope", "pwd", env=env), identity("--scope", "pwd"))

    def test_a_symlink_to_a_folder_is_the_same_folder(self):
        # Herdr gives a folder as the shell reports it (a symlink, or /tmp on
        # macOS) or as its real path. Both are one popup.
        with tempfile.TemporaryDirectory() as folder:
            real = pathlib.Path(folder).resolve() / "shop"
            real.mkdir()
            link = pathlib.Path(folder).resolve() / "link"
            link.symlink_to(real)
            by_link, owner = identity("--scope", "pwd",
                                      env=dict(ENV, HERDR_ACTIVE_PANE_CWD=str(link)))
            by_real, _ = identity("--scope", "pwd",
                                  env=dict(ENV, HERDR_ACTIVE_PANE_CWD=str(real)))
            self.assertEqual(by_link, by_real)
            # The picker shows the folder as Herdr gave it.
            self.assertEqual(owner.folder, str(link))

    def test_the_command_and_toggle_keys_are_part_of_the_id(self):
        base = identity("--toggle-key", "alt+g", "--", "lazygit")[0]
        self.assertNotEqual(identity("--toggle-key", "alt+g", "--", "lazygit", "-p")[0], base)
        self.assertNotEqual(identity("--toggle-key", "alt+g")[0], base)
        self.assertNotEqual(identity("--toggle-key", "ctrl+z", "--", "lazygit")[0], base)
        self.assertNotEqual(identity("--scope", "session", "--toggle-key", "alt+g", "--",
                                     "lazygit")[0], base)

    def test_toggle_keys_count_in_any_order(self):
        self.assertEqual(identity("--toggle-key", "alt+g", "--toggle-key", "ctrl+z")[0],
                         identity("--toggle-key", "ctrl+z", "--toggle-key", "alt+g")[0])

    def test_label_and_folder_are_not_part_of_the_id(self):
        base = identity("--", "nu")[0]
        self.assertEqual(identity("--name", "floating", "-d", "/tmp", "--", "nu")[0], base)

    def test_another_split_of_the_same_words_is_another_popup(self):
        self.assertNotEqual(identity("--", "sh -c", "x")[0], identity("--", "sh", "-c x")[0])
        self.assertNotEqual(identity("--toggle-key", "alt+a", "--", "x")[0],
                            identity("--", "x", "alt+a")[0])

    def test_a_scope_without_its_value_is_a_usage_error(self):
        for scope, name in (("tab", "HERDR_ACTIVE_TAB_ID"),
                            ("workspace", "HERDR_ACTIVE_WORKSPACE_ID"),
                            ("pwd", "HERDR_ACTIVE_PANE_CWD")):
            with self.subTest(scope=scope):
                env = {key: value for key, value in ENV.items() if key != name}
                with self.assertRaisesRegex(UsageError, f"--scope {scope} needs {name}"):
                    identity("--scope", scope, env=env)
                with self.assertRaisesRegex(UsageError, f"--scope {scope} needs {name}"):
                    identity("--scope", scope, env=dict(env, **{name: ""}))


class Labels(unittest.TestCase):
    def test_the_label_is_the_name_or_the_command(self):
        for argv, label in ((["--name", "floating", "--", "nu"], "floating"),
                            (["--", "lazygit", "-p", "my repo"], "lazygit -p 'my repo'"),
                            ([], "fish")):
            with self.subTest(argv=argv):
                self.assertEqual(popup_label(parse_args(argv), "fish"), label)

    def test_without_a_command_or_a_default_shell_the_label_is_shell(self):
        self.assertEqual(popup_label(parse_args([]), None), "shell")

    def test_the_label_the_toast_and_the_picker_name_a_program_alike(self):
        self.assertEqual(popups.program_text(["lazygit", "-p", "my repo"], "nu"),
                         "lazygit -p 'my repo'")
        self.assertEqual(popups.program_text(None, "nu"), "nu")
        self.assertEqual(popups.program_text([]), "shell")


class MainConfig(unittest.TestCase):
    CONFIG = """onboarding = false
[keys]
prefix = "ctrl+;"   # comment
help = "prefix+?"
edit_scrollback = ["prefix+e", 'alt+e']

[[keys.command]]
key = "prefix+f"
command = 'x = "y"'

[terminal]
default_shell = "nu"
"""

    def read(self, text):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "config.toml"
            path.write_text(text)
            return herdr_config.read_main_config(path)

    def test_reads_prefix_scrollback_and_shell(self):
        self.assertEqual(self.read(self.CONFIG),
                         HerdrConfig(["ctrl+;"], ["prefix+e", "alt+e"], "nu"))

    def test_missing_values_use_herdr_defaults(self):
        self.assertEqual(self.read("[keys]\nedit_scrollback = \"\"\n"),
                         HerdrConfig(["ctrl+b"], [""], None))

    def test_a_config_that_is_not_toml_is_an_error_with_its_path(self):
        with self.assertRaisesRegex(ValueError, "config.toml"):
            self.read("[keys\nprefix = 'ctrl+a'\n")


# (case name, TOML text, the HerdrConfig in it)
READER_CASES = [
    ("multi-line array with comments", """
[keys]
prefix = [
  "ctrl+;",  # the main prefix
  'ctrl+b',
]
edit_scrollback = []
""", HerdrConfig(["ctrl+;", "ctrl+b"], [], None)),
    ("hash signs inside strings", """
[keys]
prefix = "ctrl+#"  # a comment
edit_scrollback = ['prefix+#', "alt+e # not a comment"]  # [x] = "y"
[terminal]
default_shell = "/bin/sh # sh"
""", HerdrConfig(["ctrl+#"], ["prefix+#", "alt+e # not a comment"], "/bin/sh # sh")),
    ("escapes and literal strings", r"""
[terminal]
default_shell = "C:\\bin\\nu \"x\" \u00e9"
[keys]
prefix = 'C:\no'
""", HerdrConfig(["C:\\no"], ["prefix+e"], 'C:\\bin\\nu "x" \u00e9')),
    ("table text inside multi-line strings of other keys", '''
[[keys.command]]
key = "prefix+f"
command = """
[keys]
prefix = "wrong"
"""
other = """\\
  [terminal]
default_shell = "wrong" """
[keys]
prefix = "alt+a"
''', HerdrConfig(["alt+a"], ["prefix+e"], None)),
    ("multi-line literal strings", """
note = '''
[keys]
prefix = 'wrong'
'''
[keys]
prefix = 'alt+b'
""", HerdrConfig(["alt+b"], ["prefix+e"], None)),
    ("inline tables and dotted keys", """
keys = { prefix = ["ctrl+a"], edit_scrollback = "alt+e" }
terminal.default_shell = "fish"
""", HerdrConfig(["ctrl+a"], ["alt+e"], "fish")),
    ("other value types are skipped", """
name = "{session}/{name}"  # a comment
count = 3
ratio = -1.5e3
flag = true
when = 1979-05-27 07:32:00Z
mixed = [1, [2, 3], { a = 1 }, "s"]
hex = 0xDEAD_BEEF
[ui]
toast = { delivery = "herdr", seconds = 3 }
""", HerdrConfig(["ctrl+b"], ["prefix+e"], None)),
]


class ConfigShapes(unittest.TestCase):
    """The plugin reads its values from every TOML form, and checks only the keys it needs."""

    def test_every_form_gives_the_same_plugin_values(self):
        for name, text, config in READER_CASES:
            with self.subTest(case=name):
                self.assertEqual(herdr_config.herdr_config_from(tomllib.loads(text)), config)

    def test_a_needed_key_of_the_wrong_type_is_an_error(self):
        for text in ("[keys]\nprefix = 5\n", "[keys]\nprefix = ['a', 1]\n",
                     "[keys]\nedit_scrollback = { a = 'b' }\n",
                     "[terminal]\ndefault_shell = true\n", "keys = 3\n"):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    herdr_config.herdr_config_from(tomllib.loads(text))


class RealConfig(unittest.TestCase):
    """The Herdr config.toml in this repo works with the plugin."""

    PATH = pathlib.Path(__file__).resolve().parents[2] / "config.toml"

    def test_the_plugin_reads_its_values_from_it(self):
        config = herdr_config.read_main_config(self.PATH)
        self.assertTrue(config.prefix)
        for text in config.prefix:
            keys.parse_combo(text)
        for text in config.scrollback:
            if text.strip():
                keys.parse_binding(text)
        self.assertTrue(config.default_shell is None or isinstance(config.default_shell, str))

    def test_each_toggle_popup_bind_has_valid_flags(self):
        binds = tomllib.loads(self.PATH.read_text(encoding="utf-8"))["keys"]["command"]
        binds = [bind for bind in binds if "toggle-popup/" in bind["command"]]
        self.assertEqual(len(binds), 3)
        for bind in binds:
            with self.subTest(command=bind["command"]):
                # Herdr's own popup runs toggle.sh, at the size of the bind.
                self.assertEqual((bind["type"], bind["width"], bind["height"]),
                                 ("popup", "80%", "80%"))
                self.assertIn("exec ~/.config/herdr/toggle-popup/toggle.sh ", bind["command"])
                options = parse_args(shlex.split(bind["command"].split("toggle.sh", 1)[1]))
                self.assertTrue(options.toggle_keys)
                for text in options.toggle_keys:
                    keys.parse_binding(text)


class Nudge(unittest.TestCase):
    """Herdr.nudge() sends one request and does not wait for the answer."""

    def test_it_sends_the_request_and_closes_without_an_answer(self):
        folder = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "s.sock")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(path)
            server.listen()
            start = time.monotonic()
            # The fake server never answers: a client that waits would hang 5 s.
            herdr_api.Herdr(path, timeout=5).nudge("workspace.list")
            self.assertLess(time.monotonic() - start, 1)
            client, _ = server.accept()
            with client, client.makefile("rb") as stream:
                request = json.loads(stream.readline())
                self.assertEqual(stream.read(), b"")
        self.assertEqual((request["method"], request["params"]), ("workspace.list", {}))

    def test_a_missing_server_is_no_error(self):
        herdr_api.Herdr("/nonexistent/herdr.sock").nudge("workspace.list")


class SocketOwner(unittest.TestCase):
    """socket_owner_pid() tells which process listens on a Unix socket."""

    def test_it_gives_the_pid_of_the_listener(self):
        folder = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(folder.cleanup)
        path = os.path.join(folder.name, "s.sock")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(path)
            server.listen()
            self.assertEqual(herdr_api.socket_owner_pid(path), os.getpid())

    def test_a_missing_server_has_no_pid(self):
        self.assertIsNone(herdr_api.socket_owner_pid("/nonexistent/herdr.sock"))


class SocketNames(unittest.TestCase):
    def test_session_names(self):
        self.assertEqual(herdr_api.session_name("/x/herdr/sessions/work/herdr.sock"), "work")
        self.assertEqual(herdr_api.session_name("/x/herdr/herdr.sock"), "default")


class FakeMain:
    """The main Herdr session: it records toasts and can fail one method."""

    def __init__(self, fail=None):
        self.fail = fail
        self.toasts = []
        self.calls = []

    def __call__(self, endpoint, timeout=5.0):
        return self

    def call(self, method, params=None):
        self.calls.append((method, params))
        if method == "notification.show":
            self.toasts.append((params["title"], params["body"]))
            return {}
        if self.fail is not None:
            raise self.fail
        return {}

    def notify(self, title, body):
        self.call("notification.show", {"title": title, "body": body})


class ToggleScript(unittest.TestCase):
    """toggle.sh, which the popup binds run, starts toggle_popup.py on a Python."""

    SCRIPT = pathlib.Path(toggle_popup.__file__).resolve().parent / "executable_toggle.sh"
    HOMEBREW = "/opt/homebrew/bin/python3"

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        self.plugin = self.folder / "plugin dir"
        self.plugin.mkdir()
        # Each Python prints its file and its arguments.
        (self.plugin / "toggle_popup.py").write_text(
            "import os, sys\nprint(os.path.realpath(sys.executable), *sys.argv)\n",
            encoding="utf-8")
        # A python3 that only the login profile puts on PATH, as ~/.local/bin on Debian.
        self.home = self.folder / "home"
        login_bin = self.home / ".local" / "bin"
        login_bin.mkdir(parents=True)
        fake = login_bin / "python3"
        fake.write_text('#!/bin/sh\necho fake-python3 "$@"\n', encoding="utf-8")
        fake.chmod(0o755)
        (self.home / ".profile").write_text(f'PATH="{login_bin}:$PATH"\n', encoding="utf-8")
        self.log = self.folder / "herdr.log"
        herdr = self.folder / "herdr"
        herdr.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > {shlex.quote(str(self.log))}\n',
                         encoding="utf-8")
        herdr.chmod(0o755)
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.home),
                    "HERDR_BIN_PATH": str(herdr), "PYTHONDONTWRITEBYTECODE": "1"}

    def script(self, *changes):
        """A copy of toggle.sh with CHANGES: (old, new) text pairs."""
        text = self.SCRIPT.read_text(encoding="utf-8")
        for old, new in changes:
            self.assertIn(old, text)
            text = text.replace(old, new)
        script = self.plugin / "toggle.sh"
        script.write_text(text, encoding="utf-8")
        script.chmod(0o755)
        return script

    def run_script(self, script):
        # Herdr runs the bind with `/bin/sh -c` in the folder of the focused pane.
        return subprocess.run(
            ["/bin/sh", "-c", f"exec {shlex.quote(str(script))} --name 'a b' -- nu"],
            cwd=self.folder, env=self.env, capture_output=True, text=True, timeout=30)

    def test_it_runs_the_homebrew_python3_or_else_python3_of_the_login_shell(self):
        result = self.run_script(self.script())
        if os.access(self.HOMEBREW, os.X_OK):
            python = os.path.realpath(self.HOMEBREW)
        else:
            python = "fake-python3"
        self.assertEqual(result.stdout,
                         f"{python} {self.plugin}/toggle_popup.py --name a b -- nu\n")

    def test_without_homebrew_it_runs_python3_of_the_login_shell(self):
        missing = str(self.folder / "no-homebrew" / "python3")
        result = self.run_script(self.script(("p=/opt/homebrew/bin/python3", f"p={missing}")))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout,
                         f"fake-python3 {self.plugin}/toggle_popup.py --name a b -- nu\n")

    def test_without_python3_it_shows_a_toast(self):
        missing = str(self.folder / "no-homebrew" / "python3")
        # macOS always has /usr/bin/python3, so the copy looks for another name.
        script = self.script(("p=/opt/homebrew/bin/python3", f"p={missing}"),
                             ("command -v python3", "command -v no-such-python3"),
                             ('exec python3 "$0"', 'exec no-such-python3 "$0"'))
        result = self.run_script(script)
        self.assertEqual(result.returncode, 127)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "toggle-popup: python3 not found\n")
        self.assertEqual(self.log.read_text(encoding="utf-8").splitlines(), [
            "notification", "show", "Toggle popup",
            "--body", "python3 not found: toggle-popup needs Python 3.11+"])


def keep_hang_up_handlers(case):
    """toggle_popup.main() sets the SIGHUP and SIGTERM handlers: restore them after a test."""
    for signum in proxy.HANG_UP_SIGNALS:
        case.addCleanup(signal.signal, signum, signal.getsignal(signum))


def patch(case, patcher):
    """Start a mock patcher for one test."""
    patcher.start()
    case.addCleanup(patcher.stop)


class ErrorsBecomeToasts(unittest.TestCase):
    def setUp(self):
        keep_hang_up_handlers(self)
        self.main = FakeMain()
        patch(self, mock.patch.object(herdr_api, "Herdr", self.main))
        patch(self, mock.patch.dict(os.environ, HERDR_SOCKET_PATH=ENV["HERDR_SOCKET_PATH"]))

    def run_main(self, error):
        def fail(argv, env, state):
            raise error
        patch(self, mock.patch.object(toggle_popup, "toggle", fail))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = toggle_popup.main([])
        # stderr is the popup terminal: the toast tells the error.
        self.assertEqual(stderr.getvalue(), "")
        return code, stderr.getvalue()

    def test_expected_errors_show_their_message(self):
        code, stderr = self.run_main(UsageError("invalid choice: 'git'"))
        self.assertEqual(code, 1)
        self.assertEqual(self.main.toasts, [("Toggle popup", "invalid choice: 'git'")])

    def test_without_a_session_the_error_goes_to_stderr(self):
        patch(self, mock.patch.dict(os.environ))
        del os.environ["HERDR_SOCKET_PATH"]
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(toggle_popup.main([]), 1)
        self.assertEqual(stderr.getvalue(), "toggle-popup: toggle: run this from a Herdr key "
                                            "binding: HERDR_SOCKET_PATH is not set\n")
        self.assertEqual(self.main.toasts, [])

    def test_a_failed_toast_logs_the_error_too(self):
        self.main.fail = HerdrError("notification.show: timed out")

        def notify(title, body):
            raise self.main.fail

        patch(self, mock.patch.object(self.main, "notify", notify))
        patch(self, mock.patch.object(toggle_popup, "toggle",
                                      mock.Mock(side_effect=UsageError("bad flag"))))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(toggle_popup.main([]), 1)
        self.assertEqual(stderr.getvalue(), "toggle-popup: toggle: bad flag\n"
                                            "toggle-popup: toast: notification.show: timed out\n")

    def test_unexpected_errors_are_toasts_too_without_a_traceback(self):
        for error in (KeyError("HERDR_ACTIVE_WORKSPACE_ID"), TypeError("bad"), OSError(5, "EIO")):
            with self.subTest(error=error):
                self.main.toasts.clear()
                code, stderr = self.run_main(error)
                self.assertEqual(code, 1)
                self.assertEqual(len(self.main.toasts), 1)
                self.assertIn(type(error).__name__, self.main.toasts[0][1])


class PopupSessionConfig(unittest.TestCase):
    def test_each_toggle_writes_the_shell_script_for_this_python(self):
        # A version manager can remove the Python that started the server.
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name))
        shell = pathlib.Path(folder.name) / "popup-shell"
        shell.write_text("#!/bin/sh\nexec /old/python3.12 launch.py\n")
        server = mock.Mock()
        server.alive.return_value = True
        server.call.return_value = {"plugins": []}
        patch(self, mock.patch.object(herdr_api, "popup_herdr", lambda: server))
        self.assertIs(toggle_popup.ensure_popup_server(None), server)
        self.assertIn(f"exec {shlex.quote(sys.executable)} ", shell.read_text())
        self.assertEqual(shell.stat().st_mode & 0o777, 0o755)


class ForeignPopupServer(unittest.TestCase):
    """A toggle-popup server that the user started by hand loads the user's plugins.

    The plugin's own server can get a plugin too: from a `herdr plugin link`
    to its socket. The toggle unlinks it there.
    """

    TOAST = ("the toggle-popup Herdr session was not started by toggle-popup; "
             "stop it with: herdr --session toggle-popup server stop")
    STRAY = [{"plugin_id": "dotfiles.navigation"}, {"plugin_id": "dotfiles.toggle-popup"}]

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.state = pathlib.Path(folder.name) / "state"
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(self.state),
                                    XDG_CONFIG_HOME=str(pathlib.Path(folder.name) / "config")))
        # A plain file stands in for the socket file of the popup server.
        self.socket = herdr_api.session_socket(herdr_api.POPUP_SESSION)
        self.socket.parent.mkdir(parents=True)
        self.socket.write_text("")
        self.session = FakePopupSession()
        patch(self, mock.patch.object(herdr_api, "popup_herdr", lambda: self.session))
        self.starts = []
        patch(self, mock.patch.object(subprocess, "Popen",
                                      lambda *args, **kwargs: self.fail("no server start")))
        patch(self, mock.patch.object(toggle_popup, "SERVER_START_SECONDS", 1.0))
        self.registry = herdr_api.popup_config_home() / "herdr"
        (self.registry / "plugins" / "stray").mkdir(parents=True)
        (self.registry / "plugins.json").write_text("{}")
        (self.registry / "session.json").write_text("{}")
        # The pid of the server that listens on the socket.
        self.owner_pid = None
        patch(self, mock.patch.object(herdr_api, "socket_owner_pid",
                                      lambda path: self.owner_pid))

    def start_with(self, exits_after, owner_pid=None, answers=True):
        """Popen gives a server process that runs for `exits_after` polls (None: always).

        When the process starts and `answers` is true, a server answers on
        the socket: this one when owner_pid is None, else the server with pid
        `owner_pid`.
        """
        self.session.down = HerdrError("ping: no Herdr server", "gone")

        def popen(*args, **kwargs):
            self.starts.append(args)
            server = FakeServerProcess(exits_after)
            if answers:
                self.owner_pid = owner_pid or server.pid
                self.session.down = None
            return server

        patch(self, mock.patch.object(subprocess, "Popen", popen))

    def registry_names(self):
        return sorted(path.name for path in self.registry.iterdir())

    def ensure(self):
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            return toggle_popup.ensure_popup_server(None), stderr.getvalue()

    def test_the_toggle_refuses_a_server_with_plugins(self):
        self.session.plugins = list(self.STRAY)
        with self.assertRaises(HerdrError) as caught:
            self.ensure()
        self.assertEqual(str(caught.exception), self.TOAST)
        self.assertEqual(self.session.plugins, self.STRAY)

    def test_the_toggle_uses_its_own_server(self):
        self.assertIs(self.ensure()[0], self.session)

    def test_the_toggle_unlinks_each_plugin_of_its_own_server(self):
        herdr_api.remember_popup_server()
        self.session.plugins = list(self.STRAY)
        server, stderr = self.ensure()
        self.assertIs(server, self.session)
        self.assertEqual(self.session.plugins, [])
        self.assertIn("unlinked plugin dotfiles.navigation", stderr)

    def test_a_server_on_a_new_socket_file_is_not_its_own(self):
        herdr_api.remember_popup_server()
        # A server started by hand binds a new socket file.
        self.socket.unlink()
        self.socket.write_text("")
        self.session.plugins = list(self.STRAY)
        with self.assertRaisesRegex(HerdrError, "not started by toggle-popup"):
            self.ensure()
        self.assertEqual(self.session.plugins, self.STRAY)

    def test_a_new_server_loads_no_plugins_of_the_last_one(self):
        self.start_with(exits_after=None)
        self.assertIs(self.ensure()[0], self.session)
        self.assertEqual(len(self.starts), 1)
        self.assertEqual(self.registry_names(), ["session.json"])
        # The toggle knows this server as its own.
        self.assertTrue(herdr_api.own_popup_server())
        # No temporary file of the marker stays.
        self.assertEqual([name for name in os.listdir(self.state)
                          if name.startswith(herdr_api.POPUP_SERVER_FILE)],
                         [herdr_api.POPUP_SERVER_FILE])

    def test_a_server_that_takes_the_socket_first_is_not_its_own(self):
        # A server started by hand takes the socket while the toggle starts its
        # own. That one ends with "already running", at once or a bit later.
        for exits_after in (0, 2):
            with self.subTest(exits_after=exits_after):
                self.start_with(exits_after, owner_pid=1)
                with self.assertRaises(HerdrError) as caught:
                    self.ensure()
                self.assertEqual(str(caught.exception), self.TOAST)
                self.assertEqual(caught.exception.code, "not_own_server")
                self.assertFalse((self.state / herdr_api.POPUP_SERVER_FILE).exists())
                # The next toggle does not unlink the plugins of that server.
                self.session.plugins = list(self.STRAY)
                with self.assertRaisesRegex(HerdrError, "not started by toggle-popup"):
                    self.ensure()
                self.assertEqual(self.session.plugins, self.STRAY)
                self.session.plugins = []

    def test_a_server_that_ends_with_no_answer_did_not_start(self):
        self.start_with(exits_after=0, answers=False)
        with self.assertRaisesRegex(HerdrError, "did not start"):
            self.ensure()
        self.assertFalse((self.state / herdr_api.POPUP_SERVER_FILE).exists())

    def test_a_server_that_does_not_answer_in_time_is_left_alone(self):
        # The server still owns the socket: its plugin list is not removed, and no
        # second server starts.
        self.session.down = HerdrError("ping: cannot reach the socket: timed out", "unreachable")
        with self.assertRaises(HerdrError) as caught:
            self.ensure()
        self.assertEqual(caught.exception.code, "unreachable")
        self.assertEqual(self.registry_names(), ["plugins", "plugins.json", "session.json"])
        self.assertFalse((self.state / herdr_api.POPUP_SERVER_FILE).exists())


class PreparePopup(unittest.TestCase):
    """The toggle path in the popup session: create the popup or update its label."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name))
        self.owners = FakeOwners()
        self.owners.sessions[SOCKET] = ["w3"]
        patch(self, mock.patch.object(popups, "Herdr", self.owners))
        self.session = FakePopupSession()

    def prepare(self, *argv, env=ENV):
        options = parse_args(list(argv))
        popup_id, owner = popup_identity(options, env)
        toggle_popup.prepare_popup(self.session, popup_id, options, owner, "nu")
        return popups.load_record(popup_id)

    def test_a_new_popup_gets_a_record_of_its_program(self):
        record = self.prepare("--scope", "tab", "--toggle-key", "ctrl+z", "--", "lazygit")
        self.assertEqual(record, PopupRecord(
            record.id, "tab", "lazygit", "term-new1-run", ["lazygit"], ["ctrl+z"],
            Owner(SOCKET, workspace_id="w3", tab_id="w3:t2")))
        self.assertEqual(self.session.workspaces["new1"]["label"], record.id)

    def test_the_label_follows_the_bind_and_the_program_keeps_running(self):
        self.prepare("--name", "git", "--", "lazygit")
        record = self.prepare("--name", "lazygit", "-d", "/elsewhere", "--", "lazygit")
        self.assertEqual((record.label, record.terminal_id), ("lazygit", "term-new1-run"))
        self.assertEqual(list(self.session.workspaces), ["new1"])

    def test_other_toggle_keys_make_another_popup(self):
        first = self.prepare("--toggle-key", "ctrl+z", "--", "lazygit")
        second = self.prepare("--toggle-key", "ctrl+x", "--", "lazygit")
        self.assertNotEqual(first.id, second.id)
        self.assertEqual(list(self.session.workspaces), ["new1", "new2"])

    def test_the_program_pane_reports_to_the_start_check(self):
        self.prepare("--", "lazygit")
        # The root pane of the new workspace runs the default shell first.
        self.assertEqual([launch.START_ENV in env for env in self.session.start_envs],
                         [False, True])
        self.session.start_envs.clear()
        self.prepare("--scope", "tab")
        self.assertEqual([launch.START_ENV in env for env in self.session.start_envs], [True])

    def test_the_program_pane_names_the_owner_session(self):
        for argv in (["--", "lazygit"], ["--scope", "tab"]):
            with self.subTest(argv=argv):
                self.session.start_envs.clear()
                record = self.prepare(*argv)
                self.assertEqual(self.session.start_envs[-1][launch.OWNER_SOCKET_ENV],
                                 record.owner.socket)

    def test_the_program_pane_gets_the_image_socket_of_its_popup(self):
        for argv in (["--", "yazi"], ["--scope", "tab"]):
            with self.subTest(argv=argv):
                self.session.start_envs.clear()
                record = self.prepare(*argv)
                self.assertEqual(self.session.start_envs[-1][launch.IMAGE_SOCKET_ENV],
                                 str(images.socket_path(record.id)))

    def test_a_program_that_cannot_start_is_a_toast_and_leaves_no_popup(self):
        for argv in (["--", "lazygitx"], ["--scope", "tab"]):
            with self.subTest(argv=argv):
                self.session.start_error = "cannot run lazygitx: No such file or directory"
                with self.assertRaisesRegex(HerdrError, "^cannot run lazygitx: No such file"):
                    self.prepare(*argv)
                self.assertEqual(self.session.workspaces, {})
                self.assertEqual(popups.all_records(), [])

    def test_a_program_that_exits_at_once_is_a_toast(self):
        self.session.fail["pane.get"] = HerdrError("pane not found", code="pane_not_found")
        for argv, toast in ((["--", "lazygit", "-p"], "lazygit -p"),
                            (["--scope", "tab"], "nu")):
            with self.subTest(argv=argv):
                with self.assertRaisesRegex(HerdrError, f"^{toast} exited at once$"):
                    self.prepare(*argv)
                self.assertEqual(self.session.workspaces, {})

    def test_a_pane_that_never_runs_the_launcher_is_a_toast(self):
        self.session.start_error = ...
        patch(self, mock.patch.object(toggle_popup, "PROGRAM_START_SECONDS", 0.1))
        with self.assertRaisesRegex(HerdrError, "did not start in 0.1 seconds"):
            self.prepare("--", "lazygit")
        self.assertEqual(self.session.workspaces, {})

    def test_a_failed_snapshot_still_stops_the_toggle(self):
        def snapshot():
            raise HerdrError("session.snapshot: timed out")

        self.session.snapshot = snapshot
        with self.assertRaisesRegex(HerdrError, "timed out"):
            self.prepare("--", "lazygit")

    def test_a_failed_create_closes_the_new_workspace(self):
        self.session.fail["layout.apply"] = HerdrError("layout.apply: bad command")
        with self.assertRaisesRegex(HerdrError, "bad command"):
            self.prepare("--", "lazygit")
        self.assertEqual(self.session.closed, ["new1"])
        self.assertEqual(popups.all_records(), [])

    def test_a_failed_cleanup_does_not_hide_the_first_error(self):
        self.session.fail["layout.apply"] = HerdrError("layout.apply: bad command")
        self.session.fail["workspace.close"] = HerdrError("workspace.close: server gone")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            with self.assertRaisesRegex(HerdrError, "bad command"):
                self.prepare("--", "lazygit")
        self.assertIn("workspace.close: server gone", stderr.getvalue())



class FakeProxy:
    """proxy.Proxy for the toggle tests: it records its values, and its run() calls `on_run`."""

    started = []
    on_run = None

    def __init__(self, popup_id, prefix, scrollback, main_herdr, popup_herdr,
                 default_shell=None, on_shown=None, images=None):
        self.values = (popup_id, prefix, scrollback, main_herdr, popup_herdr, default_shell,
                       on_shown)
        self.images = images
        FakeProxy.last = self

    def run(self):
        self.started.append(self.values)
        if self.on_run is not None:
            self.on_run()
        if self.images is not None:
            self.images.close()


class Toggle(unittest.TestCase):
    """One toggle: the popup session, then the proxy in the same process."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name))
        self.owners = FakeOwners()
        self.owners.sessions[SOCKET] = ["w3"]
        patch(self, mock.patch.object(popups, "Herdr", self.owners))
        self.session = FakePopupSession()
        patch(self, mock.patch.object(toggle_popup, "ensure_popup_server",
                                      lambda default_shell: self.session))
        patch(self, mock.patch.object(herdr_config, "read_main_config",
                                      lambda: HerdrConfig(["ctrl+;"], ["prefix+e"], "nu")))
        self.main = FakeMain()
        patch(self, mock.patch.object(toggle_popup, "Herdr", self.main))
        patch(self, mock.patch.object(FakeProxy, "started", []))
        patch(self, mock.patch.object(toggle_popup.proxy, "Proxy", FakeProxy))

    def toggle(self, *argv):
        state = {}
        toggle_popup.toggle(list(argv), ENV, state)
        return state

    def test_the_toggle_becomes_the_proxy_of_the_popup_without_the_lock(self):
        def run():
            # The popup exists, and other keys and hooks can change the popup session.
            self.assertEqual(len(popups.live_popups(self.session.snapshot())), 1)
            with (popups.plugin_state_dir() / "popups.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        patch(self, mock.patch.object(FakeProxy, "on_run", staticmethod(run)))
        state = self.toggle("--name", "git", "--", "lazygit")
        self.assertEqual(FakeProxy.started, [(state["popup_id"], ["ctrl+;"], ["prefix+e"],
                                              self.main, self.session, "nu",
                                              toggle_popup.sweep_in_background)])
        # No Herdr popup opens: the bind's popup runs this process.
        self.assertEqual(self.main.calls, [])

    def test_the_image_socket_listens_before_the_program_starts(self):
        """The program's first image request must reach the proxy (images.py)."""
        reached = []

        def start_program(env, start=self.session.launch):
            path = env.get(launch.IMAGE_SOCKET_ENV)
            if path:
                with socket.socket(socket.AF_UNIX) as client:
                    client.connect(path)
                    reached.append(path)
            start(env)

        patch(self, mock.patch.object(self.session, "launch", start_program))
        state = self.toggle("--name", "files", "--", "yazi")
        self.assertEqual(reached, [str(images.socket_path(state["popup_id"]))])
        # The proxy gets the socket, with the request that waits on it.
        self.assertEqual(FakeProxy.last.images.popup_id, state["popup_id"])
        # The proxy closed it at its end.
        self.assertFalse(images.socket_path(state["popup_id"]).exists())

    def test_a_new_program_does_not_get_the_image_of_an_old_one(self):
        """An old program's last image request must not show over a new program."""
        argv = ["--name", "files", "--", "yazi"]
        popup_id = popup_identity(parse_args(argv), ENV)[0]
        stale = images.request_path(popup_id)
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text('{"file": "/old.png"}', encoding="utf-8")
        seen = []

        def start_program(env, start=self.session.launch):
            seen.append(stale.exists())
            start(env)

        patch(self, mock.patch.object(self.session, "launch", start_program))
        self.toggle(*argv)
        self.assertEqual(seen, [False, False])

    def test_a_failed_popup_start_closes_the_image_socket(self):
        self.session.start_error = "cannot run no-such-program: No such file or directory"
        state = {}
        with self.assertRaisesRegex(HerdrError, "cannot run no-such-program"):
            toggle_popup.toggle(["--", "no-such-program"], ENV, state)
        self.assertFalse(images.socket_path(state["popup_id"]).exists())

    def test_a_failed_popup_start_does_not_start_the_proxy(self):
        self.session.start_error = "cannot run no-such-program: No such file or directory"
        with self.assertRaisesRegex(HerdrError, "cannot run no-such-program"):
            self.toggle("--", "no-such-program")
        self.assertEqual(FakeProxy.started, [])


class HangUp(unittest.TestCase):
    """Herdr can close the popup before the proxy runs: the toggle then ends with SystemExit."""

    def setUp(self):
        keep_hang_up_handlers(self)

    def test_a_hang_up_runs_the_cleanup_of_a_half_made_popup(self):
        cleanup = []

        def toggle(argv, env, state):
            try:
                os.kill(os.getpid(), signal.SIGHUP)
                time.sleep(5)
            finally:
                cleanup.append(True)

        patch(self, mock.patch.object(toggle_popup, "toggle", toggle))
        with self.assertRaises(SystemExit) as caught:
            toggle_popup.main([])
        self.assertEqual(caught.exception.code, 128 + signal.SIGHUP)
        self.assertEqual(cleanup, [True])

    def test_the_sigterm_after_the_sighup_does_not_stop_the_cleanup(self):
        cleanup = []

        def toggle(argv, env, state):
            try:
                os.kill(os.getpid(), signal.SIGHUP)
                time.sleep(5)
            finally:
                # Herdr sends SIGTERM 250 ms after SIGHUP, as the cleanup runs.
                os.kill(os.getpid(), signal.SIGTERM)
                cleanup.append(True)

        patch(self, mock.patch.object(toggle_popup, "toggle", toggle))
        with self.assertRaises(SystemExit) as caught:
            toggle_popup.main([])
        self.assertEqual(caught.exception.code, 128 + signal.SIGHUP)
        self.assertEqual(cleanup, [True])


class SweepInBackground(unittest.TestCase):
    """The toggle's sweep runs in a process of its own, after the popup shows its program."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(self.folder)))

    def test_the_sweep_runs_in_its_own_session_under_the_lock_and_does_not_wait(self):
        go, report = self.folder / "go", self.folder / "report.json"

        def sweep(herdr):
            # The caller goes on before the sweep ends.
            deadline = time.monotonic() + 10
            while not go.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            with (popups.plugin_state_dir() / "popups.lock").open("a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    locked = False
                except BlockingIOError:
                    locked = True
            devnull = os.stat(os.devnull).st_rdev
            report.write_text(json.dumps({
                "go": go.exists(), "locked": locked, "session": os.getsid(0),
                "devnull": [os.fstat(fd).st_rdev == devnull for fd in (0, 1, 2)],
                "hang_up": signal.getsignal(signal.SIGHUP)
                == signal.SIG_DFL,
                "endpoint": herdr.endpoint}))

        patch(self, mock.patch.object(popups, "housekeeping_sweep", sweep))
        toggle_popup.sweep_in_background()
        go.write_text("")
        result = wait_for_file(report)
        self.assertEqual(result, {
            "go": True, "locked": True, "session": result["session"],
            "devnull": [True, True, True], "hang_up": True,
            "endpoint": str(herdr_api.session_socket(herdr_api.POPUP_SESSION))})
        self.assertNotEqual(result["session"], os.getsid(0))

    def test_an_error_in_the_sweep_process_never_reaches_the_caller(self):
        def sweep(herdr):
            raise RuntimeError("boom")

        patch(self, mock.patch.object(popups, "housekeeping_sweep", sweep))
        toggle_popup.sweep_in_background()
        # The caller goes on, with no child process left to reap.
        with self.assertRaises(ChildProcessError):
            os.waitpid(-1, os.WNOHANG)

    def test_a_failed_fork_only_skips_the_sweep(self):
        patch(self, mock.patch.object(os, "fork", side_effect=BlockingIOError(
            35, "Resource temporarily unavailable")))
        self.assertIsNone(toggle_popup.sweep_in_background())

    def test_the_sweep_process_keeps_no_file_of_the_caller_open(self):
        # As the viewer's pseudo-terminal: it must close when the proxy ends.
        go, done = self.folder / "go", self.folder / "done.json"

        def sweep(herdr):
            deadline = time.monotonic() + 10
            while not go.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            done.write_text("{}")

        patch(self, mock.patch.object(popups, "housekeeping_sweep", sweep))
        read_end, write_end = os.pipe()
        try:
            toggle_popup.sweep_in_background()
            os.close(write_end)
            # The sweep still runs. Only its copy of the write end could keep the pipe open.
            ready, _, _ = select.select([read_end], [], [], 5)
            self.assertEqual(ready, [read_end])
            self.assertEqual(os.read(read_end, 1), b"")
            self.assertFalse(done.exists())
        finally:
            go.write_text("")
            os.close(read_end)
        wait_for_file(done)


def wait_for_file(path, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return json.loads(path.read_text())
        except (FileNotFoundError, ValueError):
            time.sleep(0.01)
    raise AssertionError(f"no {path}")


class HousekeepingSweep(unittest.TestCase):
    """The sweep of a key press: a short owner wait, and errors only in the log."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name))
        self.owners = FakeOwners()
        self.owners.sessions[SOCKET] = ["w3"]
        patch(self, mock.patch.object(popups, "Herdr", self.owners))
        self.session = FakePopupSession()
        toggle_popup.prepare_popup(self.session, "a3f9c2", parse_args(["--", "lazygit"]),
                                   Owner(SOCKET, workspace_id="w3"), None)

    def test_a_key_press_waits_only_briefly_for_owner_sessions(self):
        popups.housekeeping_sweep(self.session)
        self.assertEqual(set(self.owners.timeouts), {popups.TOGGLE_OWNER_TIMEOUT})
        self.assertEqual(list(popups.live_popups(self.session.snapshot())), ["a3f9c2"])

    def test_a_failed_sweep_is_only_logged(self):
        # The sweep is housekeeping: an error on another stale popup must not
        # stop the popup. It can come from Herdr, the state folder, or a record file.
        cases = {
            HerdrError("workspace.close: timed out"): "workspace.close: timed out",
            PermissionError(13, "Permission denied"):
                "PermissionError: [Errno 13] Permission denied",
            ValueError("bad record"): "bad record",
        }
        for error, text in cases.items():
            with self.subTest(error=type(error).__name__):
                def sweep(herdr, owner_timeout, error=error):
                    raise error

                stderr = io.StringIO()
                with mock.patch.object(popups, "sweep", sweep), \
                        contextlib.redirect_stderr(stderr):
                    popups.housekeeping_sweep(self.session)
                self.assertEqual(stderr.getvalue(), f"toggle-popup: sweep: {text}\n")


if __name__ == "__main__":
    os.environ.pop("HERDR_CONFIG_PATH", None)
    unittest.main()
