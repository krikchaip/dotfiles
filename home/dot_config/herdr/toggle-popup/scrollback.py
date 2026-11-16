#!/usr/bin/env python3
"""The scrollback editor of a popup: $EDITOR on the recent output of its program.

prefix e (Herdr's [keys] edit_scrollback) runs open_editor() in the proxy.
It writes the program's recent output to a file in
popups.scrollback_folder(), and starts the editor in the popup session: in a
second tab of the popup's workspace, next to the program. So the editor
stays open while the popup hides, while the picker shows, and while the
frame shows another popup. While the editor runs, the popup shows the
editor (see proxy.Proxy.relay()). The picker lists popups, not panes, so the
editor has no row there.

The editor's pane runs this file through launch.py, as editor_pane():

  scrollback.py FILE

It runs $EDITOR as written, as Herdr's own scrollback editor does: `eval
"${EDITOR:-vi} \"$FILE\""`. For flags, the user puts them in $EDITOR, for
example EDITOR="nvim +" for the last line. The editor closes, and the file
goes, when:

  - the user quits the editor: the popup shows the live program again;
  - the popup is killed: Herdr closes its workspace, and so the editor's pane;
  - the program exits: editor_pane() watches its pane.

The file can hold secrets from the program's output. editor_pane() removes
it on each of these ends. popups.sweep() removes a file that a killed editor
left behind.
"""

import os
import sys

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

import contextlib
import json
import select
import signal
import socket
import time
from pathlib import Path

import herdr_api
import popups
from herdr_api import HerdrError
from launch import OWNER_SOCKET_ENV

SCROLLBACK_LINES = 100000
# The tab of the editor in the popup's workspace.
EDITOR_TAB = "scrollback"
# The values that the proxy gives the editor's pane. launch.py keeps them.
EDITOR_ENV = "TOGGLE_POPUP_EDITOR"  # The proxy's $EDITOR; empty when it has none.
PROGRAM_PANE_ENV = "TOGGLE_POPUP_PROGRAM_PANE"  # The pane id of the popup's program.
POPUP_SOCKET_ENV = "TOGGLE_POPUP_SERVER_SOCKET"  # The popup session's API socket.
# eval splits $EDITOR as a shell does, so it can hold arguments.
EDITOR_COMMAND = 'eval "${EDITOR:-vi} \\"\\$1\\""'
# After its terminal hangs up, the editor can end by itself for this long, for
# example to save its recovery state. Then editor_pane() kills what stays.
EDITOR_STOP_SECONDS = 1.0
# The events that end the program's pane.
PROGRAM_END_EVENTS = ("pane_exited", "pane_closed")
LAUNCHER = Path(__file__).resolve().parent / "launch.py"


def read_scrollback(pane_id):
    """Read the recent output of a popup pane. Bytes that are not UTF-8 become U+FFFD."""
    import subprocess

    argv, env = herdr_api.popup_session_command(
        "pane", "read", pane_id, "--source", "recent-unwrapped", "--lines", str(SCROLLBACK_LINES))
    result = subprocess.run(argv, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                            encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise HerdrError(f"pane read: {result.stderr.strip() or result.returncode}")
    return result.stdout


def open_editor(popup_herdr, popup, editor):
    """Start the scrollback editor of the LivePopup `popup` in the popup session.

    `editor` is the proxy's $EDITOR, or None. Return when the editor's pane
    runs. A popup that has an editor already keeps it. Raise HerdrError or
    OSError when the read or the start fails: then no file and no tab stay.

    The file and the tab are made under the popup lock, so that a sweep
    never sees the file of an editor without its pane.
    """
    import tempfile

    from start_check import StartCheck

    text = read_scrollback(popup.pane["pane_id"])
    with popups.popup_lock():
        popup = popups.live_popups(popup_herdr.snapshot()).get(popup.record.id)
        if popup is None or popup.editor is not None:
            return
        handle, path = tempfile.mkstemp(prefix=f"{popup.record.id}-", suffix=".txt",
                                        dir=popups.scrollback_folder())
        tab_id = None
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(text)
            with StartCheck("the scrollback editor") as start:
                env = {**start.env, OWNER_SOCKET_ENV: popup.record.owner.socket,
                       EDITOR_ENV: editor or "", PROGRAM_PANE_ENV: popup.pane["pane_id"],
                       POPUP_SOCKET_ENV: popup_herdr.endpoint}
                tab_id = popup_herdr.call("tab.create", {
                    "workspace_id": popup.workspace_id, "label": EDITOR_TAB,
                    "focus": False})["tab"]["tab_id"]
                folder = {"cwd": popup.pane["cwd"]} if popup.pane.get("cwd") else {}
                root = {"type": "pane", "command": [sys.executable, str(LAUNCHER), sys.executable,
                                                    str(Path(__file__).resolve()), path],
                        "env": env, **folder}
                tab_id = popup_herdr.call("layout.apply", {"tab_id": tab_id, "root": root})[
                    "layout"]["tab_id"]
                start.wait()
        except BaseException:
            Path(path).unlink(missing_ok=True)
            if tab_id is not None:
                with contextlib.suppress(HerdrError):
                    popup_herdr.call("tab.close", {"tab_id": tab_id})
            raise


class ProgramWatch:
    """Learn when the popup's program ends: one events.subscribe connection.

    `ended()` reads the events that wait. The program ends at an event of its
    pane in PROGRAM_END_EVENTS, and when the popup server goes: the
    connection then closes.
    """

    ANSWER_SECONDS = 5.0

    def __init__(self, endpoint, pane_id):
        """Subscribe. Raise HerdrError when the popup server refuses or does not answer."""
        self.pane_id = pane_id
        self.buffer = b""
        self.gone = False
        self.client = socket.socket(socket.AF_UNIX)
        try:
            self.client.settimeout(self.ANSWER_SECONDS)
            self.client.connect(endpoint)
            request = {"id": "toggle-popup:scrollback", "method": "events.subscribe",
                       "params": {"subscriptions": [{"type": "pane.exited"},
                                                    {"type": "pane.closed"}]}}
            self.client.sendall((json.dumps(request) + "\n").encode())
            # The answer to the request comes first, then one line per event.
            while b"\n" not in self.buffer:
                data = self.client.recv(65536)
                if not data:
                    raise HerdrError("events.subscribe: empty response", "unreachable")
                self.buffer += data
            answer, _, self.buffer = self.buffer.partition(b"\n")
            if "error" in json.loads(answer):
                raise HerdrError(f"events.subscribe: {json.loads(answer)['error']}")
            self.client.settimeout(None)
            self._take_events()
        except (OSError, ValueError) as error:
            self.client.close()
            raise HerdrError(f"events.subscribe: {error}", "unreachable") from error
        except BaseException:
            self.client.close()
            raise

    def fileno(self):
        return self.client.fileno()

    def ended(self):
        """Read what waits on the connection. Return True when the program ended."""
        try:
            data = self.client.recv(65536)
        except InterruptedError:
            return self.gone
        except OSError:
            data = b""
        if not data:
            self.gone = True
            return True
        self.buffer += data
        self._take_events()
        return self.gone

    def _take_events(self):
        *lines, self.buffer = self.buffer.split(b"\n")
        for line in lines:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            data = message.get("data") or {}
            if message.get("event") in PROGRAM_END_EVENTS and data.get("pane_id") == self.pane_id:
                self.gone = True

    def close(self):
        self.client.close()


def program_runs(endpoint, pane_id):
    """True while the program's pane exists. Ask after the watch started."""
    try:
        herdr_api.Herdr(endpoint).call("pane.get", {"pane_id": pane_id})
    except HerdrError as error:
        if error.code in ("pane_not_found", "gone"):
            return False
        raise
    return True


class EditorProcess:
    """$EDITOR in its own process group, in the foreground of the pane's terminal.

    So the terminal's signals, such as ctrl+c in an editor that does not
    read it as a key, reach only the editor.
    """

    def __init__(self, path):
        self.pid = os.fork()
        if self.pid == 0:
            try:
                os.setpgid(0, 0)
                for signum in (signal.SIGINT, signal.SIGQUIT, signal.SIGTSTP, signal.SIGTTOU,
                               signal.SIGTTIN, signal.SIGHUP, signal.SIGTERM, signal.SIGCHLD):
                    signal.signal(signum, signal.SIG_DFL)
                os.execv("/bin/sh", ["/bin/sh", "-c", EDITOR_COMMAND, "sh", path])
            except OSError as error:
                os.write(2, f"toggle-popup: cannot run /bin/sh: {error}\n".encode())
            finally:
                os._exit(127)
        with contextlib.suppress(OSError):
            os.setpgid(self.pid, self.pid)
        # Without a terminal (as in a test), the editor stays in the background.
        with contextlib.suppress(OSError):
            os.tcsetpgrp(0, self.pid)
        self.status = None

    def poll(self):
        """Return the exit status of the editor's shell, or None while it runs."""
        if self.status is None:
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                pid, status = self.pid, 0
            if pid:
                self.status = os.waitstatus_to_exitcode(status)
        return self.status

    def _group_alive(self):
        self.poll()
        try:
            os.killpg(self.pid, 0)
        except (ProcessLookupError, PermissionError):
            # macOS gives EPERM for a group that holds only a zombie.
            return False
        return True

    def stop(self, seconds=EDITOR_STOP_SECONDS):
        """Hang up the editor, as when its terminal window closes.

        Its processes get SIGHUP and can end by themselves, for example to
        keep their recovery state. After `seconds` they are killed.
        """
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(self.pid, signal.SIGHUP)
        deadline = time.monotonic() + seconds
        while self._group_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        if self._group_alive():
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(self.pid, signal.SIGKILL)
        if self.status is None:
            with contextlib.suppress(ChildProcessError):
                _, status = os.waitpid(self.pid, 0)
                self.status = os.waitstatus_to_exitcode(status)


def editor_pane(path, env):
    """Run the editor on `path` until it ends, the program ends, or the pane closes.

    Remove the file at each end. Return the exit status for the pane.
    """
    editor = env.pop(EDITOR_ENV, "")
    program = env.pop(PROGRAM_PANE_ENV, "")
    endpoint = env.pop(POPUP_SOCKET_ENV, "")
    if editor:
        env["EDITOR"] = editor
    else:
        env.pop("EDITOR", None)
    # The pane closes: Herdr hangs up its terminal (SIGHUP, then SIGTERM).
    wake_read, wake_write = os.pipe()
    os.set_blocking(wake_write, False)
    hung_up = []

    def on_signal(signum, _frame):
        if signum != signal.SIGCHLD:
            hung_up.append(signum)

    signal.set_wakeup_fd(wake_write)
    for signum in (signal.SIGHUP, signal.SIGTERM, signal.SIGCHLD):
        signal.signal(signum, on_signal)
    # The editor owns the terminal: its keys never stop this process.
    for signum in (signal.SIGINT, signal.SIGQUIT, signal.SIGTSTP, signal.SIGTTOU,
                   signal.SIGTTIN):
        signal.signal(signum, signal.SIG_IGN)
    watch = process = None
    try:
        watch = ProgramWatch(endpoint, program)
        if not program_runs(endpoint, program):
            return 0
        process = EditorProcess(path)
        while process.poll() is None and not hung_up and not watch.gone:
            ready, _, _ = select.select([wake_read, watch], [], [])
            if wake_read in ready:
                with contextlib.suppress(BlockingIOError):
                    os.read(wake_read, 64)
            if watch in ready and watch.ended():
                break
        if process.poll() is None:
            # The file goes first: Herdr kills the pane's processes soon after its SIGHUP.
            Path(path).unlink(missing_ok=True)
            process.stop()
            return 0
        return process.status
    finally:
        Path(path).unlink(missing_ok=True)
        if watch is not None:
            watch.close()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: scrollback.py FILE", file=sys.stderr)
        return 2
    try:
        return editor_pane(argv[0], os.environ)
    except (HerdrError, OSError) as error:
        Path(argv[0]).unlink(missing_ok=True)
        herdr_api.log_error("scrollback", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
