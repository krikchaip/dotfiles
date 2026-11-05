"""The Python version guard of the three entry points, on a Python older than 3.11.

macOS shell keys run `python3` as /usr/bin/python3 (3.9). These tests run the
real entry files on that Python in a subprocess.
"""

import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import unittest.mock

PLUGIN = pathlib.Path(__file__).resolve().parents[1]
ENTRY_POINTS = ("toggle_popup.py", "proxy.py", "hooks.py")
MESSAGE = "toggle-popup needs Python 3.11+ (found {})"


def old_python():
    """A Python older than 3.11: its command, its real interpreter, and its "X.Y" version.

    On macOS /usr/bin/python3 is an xcrun shim. It finds the tool by its own
    name, so a link to it under another name, such as python3.39, makes macOS
    show an install dialog. Links in these tests point to the real interpreter.
    """
    for path in ("/usr/bin/python3", "/usr/bin/python3.9", "/usr/bin/python3.10"):
        if not os.access(path, os.X_OK):
            continue
        result = subprocess.run(
            [path, "-c", "import sys; print('%d.%d' % sys.version_info[:2]); "
             "print(sys.executable)"], capture_output=True, text=True, check=False)
        lines = result.stdout.split()
        if result.returncode or len(lines) != 2:
            continue
        version, executable = lines
        if tuple(map(int, version.split("."))) < (3, 11):
            return path, os.path.realpath(executable), version
    return None, None, None


OLD_PYTHON, OLD_INTERPRETER, OLD_VERSION = old_python()


class ToastServer:
    """A fake Herdr socket that records each request and answers it."""

    def __init__(self, path):
        self.requests = []
        self.stopped = threading.Event()
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen()
        # A short timeout lets close() stop the thread soon.
        self.server.settimeout(0.05)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stopped.is_set():
            try:
                client, _ = self.server.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            client.settimeout(5)
            with client, client.makefile("rw", encoding="utf-8") as stream:
                line = stream.readline()
                if line:
                    request = json.loads(line)
                    self.requests.append(request)
                    stream.write(json.dumps({"id": request["id"], "result": {}}) + "\n")

    def close(self):
        self.stopped.set()
        self.thread.join(5)
        self.server.close()


class Candidates(unittest.TestCase):
    """Which `python3.N` files the check may run. These tests run no Python."""

    def setUp(self):
        sys.path.insert(0, str(PLUGIN))
        self.addCleanup(sys.path.remove, str(PLUGIN))
        import python_guard

        self.guard = python_guard

    @unittest.skipUnless(sys.platform == "darwin", "the xcrun shims are on macOS")
    def test_a_macos_shim_in_usr_bin_is_never_a_candidate(self):
        self.assertTrue(self.guard.xcrun_shim("/usr/bin/python3"))
        self.assertFalse(self.guard.xcrun_shim(sys.executable))
        # A check that names a shim as its interpreter does not pass either.
        self.assertFalse(self.guard.usable("/usr/bin/python3"))
        self.assertTrue(self.guard.usable(os.path.realpath(sys.executable)))

    def test_candidates_come_newest_first(self):
        with tempfile.TemporaryDirectory() as folder:
            for minor in (12, 39, 11):
                path = pathlib.Path(folder) / f"python3.{minor}"
                path.write_text("#!/bin/sh\nexit 1\n")
                path.chmod(0o755)
            with unittest.mock.patch.dict(os.environ, PATH=folder):
                found = list(self.guard.newer_pythons())
        self.assertEqual([pathlib.Path(path).name for path in found],
                         ["python3.39", "python3.12", "python3.11"])

    def test_the_first_folder_on_path_wins_as_with_which(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = pathlib.Path(folder) / "a", pathlib.Path(folder) / "b"
            for place in (first, second):
                place.mkdir()
                for name in ("python3.12", "python3.120", "python3.12-config", "python3.012",
                             "python3.10", "python3.13"):
                    path = place / name
                    path.write_text("#!/bin/sh\nexit 1\n")
                    path.chmod(0o755)
            # Not a candidate: a file that does not run, and a folder.
            (first / "python3.13").chmod(0o644)
            (first / "python3.14").mkdir()
            path = os.pathsep.join([str(folder) + "/missing", str(first), str(second)])
            with unittest.mock.patch.dict(os.environ, PATH=path):
                found = list(self.guard.newer_pythons())
        self.assertEqual(found, [str(first / "python3.120"), str(second / "python3.13"),
                                 str(first / "python3.12")])


class CheckedPythons(unittest.TestCase):
    """The file that keeps the Python that passed the check. These tests run no Python."""

    def setUp(self):
        sys.path.insert(0, str(PLUGIN))
        self.addCleanup(sys.path.remove, str(PLUGIN))
        import python_guard

        self.guard = python_guard
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        self.python = self.folder / "python3.39"
        self.python.write_text("#!/bin/sh\n")
        # The interpreter file that the check of python3.39 names.
        self.interpreter = self.folder / "interpreter"
        self.interpreter.write_text("#!/bin/sh\n")
        self.interpreter.chmod(0o755)
        state = self.folder / "state" / "plugin"
        patcher = unittest.mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(state))
        patcher.start()
        self.addCleanup(patcher.stop)

    def remember(self):
        self.guard.remember(str(self.python), str(self.interpreter))

    def test_a_remembered_python_is_checked_until_a_file_changes(self):
        self.assertIsNone(self.guard.checked(str(self.python)))
        # Another file at the same path, as after an upgrade.
        for path in (self.python, self.interpreter):
            with self.subTest(changed=path.name):
                self.remember()
                self.assertEqual(self.guard.checked(str(self.python)), str(self.interpreter))
                os.utime(path, ns=(0, 0))
                self.assertIsNone(self.guard.checked(str(self.python)))

    def test_a_removed_interpreter_is_not_checked(self):
        self.remember()
        self.interpreter.unlink()
        self.assertIsNone(self.guard.checked(str(self.python)))

    def test_only_the_remembered_path_is_checked(self):
        other = self.folder / "python3.40"
        other.write_text("#!/bin/sh\n")
        self.remember()
        self.assertIsNone(self.guard.checked(str(other)))

    def test_a_state_folder_that_cannot_be_written_costs_only_time(self):
        (self.folder / "state").write_text("not a folder")
        self.remember()
        self.assertIsNone(self.guard.checked(str(self.python)))


@unittest.skipIf(OLD_PYTHON is None, "needs a Python older than 3.11")
class OldPython(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        self.bin = self.folder / "bin"
        self.bin.mkdir()

    def run_entry(self, name, cwd=None, **env):
        base = {"PATH": str(self.bin), "HOME": str(self.folder), "PYTHONDONTWRITEBYTECODE": "1"}
        return subprocess.run([OLD_PYTHON, str(PLUGIN / name), "startup"],
                              env=dict(base, **env), cwd=cwd or self.folder,
                              capture_output=True, text=True, timeout=30, check=False)

    def run_with_toasts(self, name):
        """Run an entry point with a fake Herdr socket. Return the result and the toasts."""
        path = self.folder / f"{name}.sock"
        server = ToastServer(str(path))
        try:
            result = self.run_entry(name, HERDR_SOCKET_PATH=str(path))
        finally:
            server.close()
            path.unlink()
        self.assertNotIn("Traceback", result.stderr)
        toasts = [request["params"]["body"] for request in server.requests
                  if request["method"] == "notification.show"]
        return result, toasts

    def fake_python(self, minor, script):
        path = self.bin / f"python3.{minor}"
        path.write_text("#!/bin/sh\n" + script)
        path.chmod(0o755)
        return path

    def test_without_a_newer_python_a_toggle_or_popup_shows_one_clear_toast(self):
        message = MESSAGE.format(OLD_VERSION)
        for name in ("toggle_popup.py", "proxy.py"):
            with self.subTest(entry=name):
                result, toasts = self.run_with_toasts(name)
                self.assertEqual(result.returncode, 1)
                self.assertIn(message, result.stderr)
                self.assertEqual(toasts, [message])

    def test_without_a_newer_python_a_hook_writes_only_to_stderr(self):
        result, toasts = self.run_with_toasts("hooks.py")
        self.assertEqual(result.returncode, 1)
        self.assertIn("toggle-popup: hook: " + MESSAGE.format(OLD_VERSION), result.stderr)
        self.assertEqual(toasts, [])

    def test_a_newer_python_on_the_path_runs_the_entry_point_again(self):
        # The plugin then runs on the newer Python. Without HERDR_SOCKET_PATH,
        # the toggle and the proxy fail in their own code, and the hook does nothing.
        (self.bin / f"python3.{sys.version_info.minor}").symlink_to(sys.executable)
        expected = {"toggle_popup.py": 1, "proxy.py": 1, "hooks.py": 0}
        for name, code in expected.items():
            with self.subTest(entry=name):
                result = self.run_entry(name)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertNotIn("needs Python", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                if code:
                    self.assertIn("HERDR_SOCKET_PATH is not set", result.stderr)

    def test_an_import_of_an_entry_point_does_not_start_again(self):
        # `python3 -m unittest` imports the entry points: sys.argv[0] is no script.
        (self.bin / f"python3.{sys.version_info.minor}").symlink_to(sys.executable)
        result = subprocess.run(
            [OLD_PYTHON, "-c", f"import sys; sys.path.insert(0, {str(PLUGIN)!r}); "
             "import toggle_popup"], env={"PATH": str(self.bin), "HOME": str(self.folder),
                                          "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn(MESSAGE.format(OLD_VERSION), result.stderr)
        self.assertNotIn("can't open file", result.stderr)

    def test_the_check_of_a_newer_python_runs_once_for_each_file(self):
        runs = self.folder / "runs.txt"
        python = self.fake_python(39, f'echo "$1" >> {runs}\nexec {sys.executable} "$@"\n')
        for _ in range(2):
            result = self.run_entry("toggle_popup.py")
            self.assertIn("HERDR_SOCKET_PATH is not set", result.stderr)
        self.assertEqual(runs.read_text().split(), ["-I"])
        os.utime(python, ns=(0, 0))
        self.run_entry("toggle_popup.py")
        self.assertEqual(runs.read_text().split(), ["-I", "-I"])

    def test_the_guard_runs_the_interpreter_of_a_version_manager_shim(self):
        # A pyenv, asdf or mise shim selects a Python from the current folder.
        # This one fails when the folder has a .python-version file.
        runs = self.folder / "runs.txt"
        self.fake_python(39, f'echo "$1" >> {runs}\n'
                             '[ -e .python-version ] && exit 127\n'
                             f'exec {sys.executable} "$@"\n')
        result = self.run_entry("toggle_popup.py")
        self.assertIn("HERDR_SOCKET_PATH is not set", result.stderr)
        checked = (self.folder / ".local" / "state" / "herdr" / "plugins" / "dotfiles.toggle-popup"
                   / "python-checked.txt").read_text().split("\n")
        self.assertEqual(checked[0], str(self.bin / "python3.39"))
        self.assertEqual(checked[2], os.path.realpath(sys.executable))
        # A key in the pane of another project: the shim is not run again.
        project = self.folder / "project"
        project.mkdir()
        (project / ".python-version").write_text("3.8\n")
        result = self.run_entry("toggle_popup.py", cwd=project)
        self.assertIn("HERDR_SOCKET_PATH is not set", result.stderr)
        self.assertNotIn("needs Python", result.stderr)
        self.assertEqual(runs.read_text().split(), ["-I"])

    def test_a_newer_name_that_fails_the_check_is_skipped(self):
        # python3.39 is the old Python under a new name: it has no tomllib.
        (self.bin / "python3.39").symlink_to(OLD_INTERPRETER)
        (self.bin / f"python3.{sys.version_info.minor}").symlink_to(sys.executable)
        result = self.run_entry("toggle_popup.py")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("HERDR_SOCKET_PATH is not set", result.stderr)
        self.assertNotIn("needs Python", result.stderr)

    def test_a_python_that_runs_the_old_python_again_stops_with_one_toast(self):
        # It passes the check, but its interpreter is the old Python: the guard
        # must not loop.
        self.fake_python(39, f'printf %s {OLD_INTERPRETER}\n')
        result, toasts = self.run_with_toasts("toggle_popup.py")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(toasts, [MESSAGE.format(OLD_VERSION)])

    def test_a_python_that_cannot_run_is_a_toast_with_the_reason(self):
        # It passes the check, but the interpreter file that it names is no program.
        interpreter = self.folder / "interpreter"
        interpreter.write_text("not a program\n")
        interpreter.chmod(0o755)
        self.fake_python(39, f'printf %s {interpreter}\n')
        result, toasts = self.run_with_toasts("toggle_popup.py")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(toasts), 1)
        self.assertRegex(toasts[0], f"^cannot run {interpreter}: .*Exec format error")


if __name__ == "__main__":
    unittest.main()
