"""The popup server's environment: no plugins, the same socket, and the user's values in panes."""

import json
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import herdr_api
import launch
import toggle_popup

LAUNCHER = pathlib.Path(herdr_api.__file__).resolve().parent / "launch.py"
USER = {
    "HOME": "/home/u",
    "PATH": "/usr/bin:/bin",
    "SHELL": "/bin/zsh",
    "XDG_CONFIG_HOME": "/home/u/.cfg",
    "XDG_STATE_HOME": "/home/u/.state",
    "HERDR_SOCKET_PATH": "/home/u/.cfg/herdr/sessions/work/herdr.sock",
    "HERDR_CONFIG_PATH": "/home/u/herdr.toml",
    "HERDR_ENV": "1",
    "HERDR_PANE_ID": "w1:p1",
    "HERDR_BIN_PATH": "/opt/herdr",
}


class PopupSessionCommand(unittest.TestCase):
    def command(self, env=USER):
        with mock.patch.dict(os.environ, env, clear=True):
            return herdr_api.popup_session_command("pane", "read", "w1:p1")

    def test_the_socket_stays_in_the_users_config_folder_without_session_flag(self):
        # With --session, Herdr ignores HERDR_SOCKET_PATH (src/session.rs:176-182).
        argv, env = self.command()
        self.assertEqual(argv, ["/opt/herdr", "pane", "read", "w1:p1"])
        self.assertEqual(env["HERDR_SOCKET_PATH"],
                         "/home/u/.cfg/herdr/sessions/toggle-popup/herdr.sock")

    def test_a_private_config_folder_has_no_plugin_list(self):
        # Herdr reads plugins.json from $XDG_CONFIG_HOME/herdr (src/persist/plugin_registry.rs:12).
        _, env = self.command()
        state = "/home/u/.state/herdr/plugins/dotfiles.toggle-popup"
        self.assertEqual(env["XDG_CONFIG_HOME"], f"{state}/popup-config")
        self.assertEqual(env["HERDR_CONFIG_PATH"], f"{state}/popup-session.toml")

    def test_the_main_sessions_herdr_values_do_not_reach_the_popup_session(self):
        _, env = self.command()
        self.assertEqual(sorted(key for key in env if key.startswith("HERDR_")),
                         ["HERDR_BIN_PATH", "HERDR_CONFIG_PATH", "HERDR_SOCKET_PATH"])
        self.assertEqual((env["HOME"], env["PATH"]), (USER["HOME"], USER["PATH"]))

    def test_the_user_values_go_to_the_launcher(self):
        _, env = self.command()
        self.assertEqual(json.loads(env[launch.USER_ENV]), {
            "XDG_CONFIG_HOME": "/home/u/.cfg", "SHELL": "/bin/zsh",
            "HERDR_CONFIG_PATH": "/home/u/herdr.toml"})
        unset = {key: value for key, value in USER.items()
                 if key not in ("XDG_CONFIG_HOME", "HERDR_CONFIG_PATH")}
        _, env = self.command(unset)
        self.assertEqual(json.loads(env[launch.USER_ENV]),
                         {"XDG_CONFIG_HOME": None, "SHELL": "/bin/zsh", "HERDR_CONFIG_PATH": None})
        self.assertEqual(env["HERDR_SOCKET_PATH"],
                         "/home/u/.config/herdr/sessions/toggle-popup/herdr.sock")

    def test_the_command_does_not_make_folders(self):
        with tempfile.TemporaryDirectory() as folder:
            self.command(dict(USER, XDG_STATE_HOME=folder))
            self.assertEqual(os.listdir(folder), [])


class PopupShell(unittest.TestCase):
    """The popup-shell script, the popup server's default shell, holds the main default shell."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        patcher = mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def shell(self, name):
        path = self.folder / name
        path.write_text(f"#!/bin/sh\nprintf '%s\\n' {shlex.quote(name)}\n")
        path.chmod(0o755)
        return str(path)

    def run_popup_shell(self, **env):
        """Run popup-shell as the popup server does for a new shell popup."""
        base = {"PATH": os.environ["PATH"], launch.USER_ENV: json.dumps({})}
        result = subprocess.run([str(self.folder / "popup-shell")], env=dict(base, **env),
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_a_new_shell_popup_uses_the_current_default_shell(self):
        # The popup server keeps running: only the script changes.
        toggle_popup.popup_session_config(self.shell("first"))
        self.assertEqual(self.run_popup_shell(), "first\n")
        toggle_popup.popup_session_config(self.shell("second"))
        self.assertEqual(self.run_popup_shell(), "second\n")

    def test_without_a_default_shell_the_users_shell_runs(self):
        toggle_popup.popup_session_config(None)
        # A value in the server's environment does not count.
        stale = {launch.DEFAULT_SHELL_ENV: self.shell("stale")}
        self.assertEqual(self.run_popup_shell(SHELL=self.shell("mine"), **stale), "mine\n")

    def test_a_shell_path_with_spaces_and_quotes(self):
        toggle_popup.popup_session_config(self.shell("it's here"))
        self.assertEqual(self.run_popup_shell(), "it's here\n")


class Launcher(unittest.TestCase):
    """launch.py gives a backing pane's program the user's values back."""

    def launch(self, user, *argv, **env):
        base = {"PATH": os.environ["PATH"], "XDG_CONFIG_HOME": "/private/popup-config",
                "HERDR_CONFIG_PATH": "/private/popup-session.toml", "SHELL": "/private/shell",
                launch.USER_ENV: json.dumps(user)}
        result = subprocess.run([sys.executable, str(LAUNCHER), *argv], env=dict(base, **env),
                                capture_output=True, text=True, timeout=10)
        return result

    def environment(self, user):
        result = self.launch(user, "/usr/bin/env")
        self.assertEqual(result.returncode, 0, result.stderr)
        return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)

    def test_a_user_value_comes_back(self):
        env = self.environment({"XDG_CONFIG_HOME": "/home/u/.cfg", "SHELL": "/bin/zsh",
                                "HERDR_CONFIG_PATH": None})
        self.assertEqual(env["XDG_CONFIG_HOME"], "/home/u/.cfg")
        self.assertEqual(env["SHELL"], "/bin/zsh")
        self.assertNotIn("HERDR_CONFIG_PATH", env)
        self.assertNotIn(launch.USER_ENV, env)

    def test_a_value_that_the_user_did_not_set_is_removed(self):
        env = self.environment({"XDG_CONFIG_HOME": None, "SHELL": None, "HERDR_CONFIG_PATH": None})
        for name in ("XDG_CONFIG_HOME", "SHELL", "HERDR_CONFIG_PATH"):
            self.assertNotIn(name, env)

    def test_herdr_values_name_the_owner_session_not_the_popup_server(self):
        popup_server = {"HERDR_ENV": "1", "HERDR_BIN_PATH": "/opt/bin/herdr",
                        "HERDR_SOCKET_PATH": "/c/herdr/sessions/toggle-popup/herdr.sock",
                        "HERDR_PANE_ID": "w1:p1", "HERDR_TAB_ID": "w1:t1",
                        "HERDR_WORKSPACE_ID": "w1"}
        user = {"XDG_CONFIG_HOME": None, "SHELL": None, "HERDR_CONFIG_PATH": None}
        result = self.launch(user, "/usr/bin/env", **popup_server,
                             **{launch.OWNER_SOCKET_ENV: "/c/herdr/herdr.sock"})
        env = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        herdr = {name: value for name, value in env.items() if name.startswith("HERDR_")}
        self.assertEqual(herdr, {"HERDR_ENV": "1", "HERDR_SOCKET_PATH": "/c/herdr/herdr.sock",
                                 "HERDR_BIN_PATH": "/opt/bin/herdr"})
        self.assertNotIn(launch.OWNER_SOCKET_ENV, env)

    def test_pwd_names_the_folder_that_the_program_starts_in(self):
        # Each pane inherits the PWD of the toggle that started the popup server.
        # yazi trusts PWD, so a stale one started it in that old folder.
        user = {"XDG_CONFIG_HOME": None, "SHELL": None, "HERDR_CONFIG_PATH": None}
        with tempfile.TemporaryDirectory() as old, tempfile.TemporaryDirectory() as start:
            real = os.path.realpath(start)
            for pwd, expected in ((old, real), ("", real), ("relative", real),
                                  ("/no/such/folder", real), (real, real)):
                with self.subTest(pwd=pwd):
                    result = subprocess.run(
                        # Not a shell: a shell fixes PWD itself, as yazi does not.
                        [sys.executable, str(LAUNCHER), "/usr/bin/printenv", "PWD"],
                        cwd=start, capture_output=True, text=True, timeout=10,
                        env={"PATH": os.environ["PATH"], "PWD": pwd,
                             launch.USER_ENV: json.dumps(user)})
                    self.assertEqual(result.stdout.strip(), expected, result.stderr)

    def test_a_pwd_with_a_symlink_to_the_real_folder_stays(self):
        with tempfile.TemporaryDirectory() as folder:
            real = pathlib.Path(folder, "real")
            real.mkdir()
            link = pathlib.Path(folder, "link")
            link.symlink_to(real)
            with mock.patch.object(launch.os, "getcwd", return_value=str(real)):
                env = {"PWD": str(link)}
                launch.fix_pwd(env)
                self.assertEqual(env, {"PWD": str(link)})

    def test_without_an_owner_socket_no_herdr_command_reaches_the_popup_server(self):
        env = {"HERDR_SOCKET_PATH": "/c/herdr/sessions/toggle-popup/herdr.sock",
               "HERDR_PANE_ID": "w1:p1"}
        launch.use_owner_session(env)
        self.assertEqual(env, {})

    def test_without_a_command_it_runs_the_default_shell(self):
        with tempfile.TemporaryDirectory() as folder:
            shell = pathlib.Path(folder) / "myshell"
            shell.write_text('#!/bin/sh\necho "shell $XDG_CONFIG_HOME $SHELL"\n')
            shell.chmod(0o755)
            user = {"XDG_CONFIG_HOME": "/home/u/.cfg", "SHELL": "/bin/zsh"}
            result = self.launch(user, **{launch.DEFAULT_SHELL_ENV: str(shell)})
            self.assertEqual(result.stdout, "shell /home/u/.cfg /bin/zsh\n")
            # Without a default shell from the config: the user's SHELL, as in Herdr.
            result = self.launch(dict(user, SHELL=str(shell)))
            self.assertEqual(result.stdout, f"shell /home/u/.cfg {shell}\n")

    def test_the_default_shell_is_a_login_shell_on_macos_as_in_herdr(self):
        # Herdr's "auto" shell mode: a login shell (argv0 "-nu") only on macOS.
        self.assertEqual(launch.shell_argv0("/opt/bin/nu", "darwin"), "-nu")
        self.assertEqual(launch.shell_argv0("/opt/bin/nu", "linux"), "nu")

    def test_a_started_program_passes_the_start_check(self):
        with toggle_popup.StartCheck() as start:
            # The program runs longer than the wait: the connection closes at its start.
            process = subprocess.Popen(
                [sys.executable, str(LAUNCHER), "/bin/sh", "-c",
                 f'echo "start=${{{launch.START_ENV}-unset}}"; sleep 3'],
                env=dict(os.environ, **start.env), stdout=subprocess.PIPE, text=True)
            self.addCleanup(process.wait)
            self.addCleanup(process.kill)
            with mock.patch.object(toggle_popup, "PROGRAM_START_SECONDS", 2):
                start.wait()
            # The program does not get the start check value.
            self.assertEqual(process.stdout.readline(), "start=unset\n")
            process.stdout.close()

    def test_a_program_that_cannot_start_fails_the_start_check_with_its_error(self):
        with tempfile.TemporaryDirectory() as folder:
            not_a_program = pathlib.Path(folder) / "notes.txt"
            not_a_program.write_text("text\n")
            cases = {"no-such-program-x": "No such file or directory",
                     str(not_a_program): "Permission denied"}
            for program, reason in cases.items():
                with self.subTest(program=program), toggle_popup.StartCheck() as start:
                    result = self.launch({}, program, **start.env)
                    with self.assertRaises(herdr_api.HerdrError) as raised:
                        start.wait()
                    self.assertEqual(str(raised.exception), f"cannot run {program}: {reason}")
                    self.assertEqual(result.returncode, 127)

    def test_a_launcher_that_does_not_run_fails_the_start_check(self):
        with toggle_popup.StartCheck() as start, \
                mock.patch.object(toggle_popup, "PROGRAM_START_SECONDS", 0.2):
            with self.assertRaisesRegex(herdr_api.HerdrError,
                                        "^the popup program did not start in 0.2 seconds$"):
                start.wait()

    def test_a_failed_start_check_leaves_no_folder(self):
        made = []
        real_mkdtemp = tempfile.mkdtemp

        def mkdtemp(**kwargs):
            made.append(real_mkdtemp(**kwargs))
            return made[-1]

        with mock.patch.object(tempfile, "mkdtemp", mkdtemp), \
                mock.patch.object(toggle_popup.socket.socket, "listen",
                                  side_effect=OSError("no listen")):
            with self.assertRaisesRegex(OSError, "no listen"):
                with toggle_popup.StartCheck():
                    pass
        self.assertFalse(os.path.exists(made[0]))

    def test_a_start_check_that_stopped_does_not_stop_the_program(self):
        result = self.launch({}, "/bin/sh", "-c", "echo ran",
                             **{launch.START_ENV: "/nonexistent/start.sock"})
        self.assertEqual((result.returncode, result.stdout), (0, "ran\n"))

    def test_a_missing_program_is_one_error_line(self):
        result = self.launch({}, "no-such-program-x")
        self.assertEqual(result.returncode, 127)
        self.assertEqual(result.stderr,
                         "toggle-popup: cannot run no-such-program-x: No such file or directory\n")


if __name__ == "__main__":
    unittest.main()
