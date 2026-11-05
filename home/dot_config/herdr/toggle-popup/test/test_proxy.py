"""The proxy: its relay loop, event trace, help page, scrollback, kill, and start errors."""

import contextlib
import errno
import fcntl
import io
import os
import pathlib
import re
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import tty
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import herdr_api
import keys
import popups
import proxy
from fakes import FakeOwners, FakePopupSession
from keys import Action, Combo
from popups import Owner, PopupRecord
from proxy import Next, ViewerEnd


def patch(case, patcher):
    """Start a mock patcher for one test."""
    patcher.start()
    case.addCleanup(patcher.stop)


# proxy.Viewer before a test replaces it with fake viewers.
REAL_VIEWER = proxy.Viewer


class FakeViewer:
    """A viewer that is one end of a socket pair. The test holds the other end.

    `end` is (exit status, stderr) for finish(). With `ended`, the viewer ends
    at once, as a failed attach does.
    """

    def __init__(self, terminal_id="term-w1", size_fd=0, end=(0, ""), ended=False):
        self.peer, self.ours = socket.socketpair()
        self.fd = self.ours.fileno()
        self.peer.settimeout(5)
        self.errors_fd = None
        self.terminal_id, self.end = terminal_id, end
        self.size_fd = size_fd
        self.nudge = proxy.AttachNudge(lambda: None)
        if ended:
            self.peer.shutdown(socket.SHUT_RDWR)

    def read(self):
        return REAL_VIEWER.read(self)

    def resize(self):
        pass

    def stop(self, drain_to=None):
        if drain_to is not None:
            drain_to(b"\x1b[?1049l")

    def finish(self):
        return self.end

    def close(self):
        self.ours.close()
        self.peer.close()


class FakeMain:
    """The main Herdr session of the popup: its workspaces and tabs, and the calls to it."""

    def __init__(self, endpoint="/x/sessions/work/herdr.sock"):
        self.endpoint = endpoint
        self.workspaces = [("w1", "home"), ("w2", "notes")]
        # (tab id, tab label)
        self.tabs = [("w1:t1", "1"), ("w1:t2", "logs"), ("w2:t1", "1")]
        self.calls = []
        self.fail = None

    def snapshot(self):
        if self.fail:
            raise herdr_api.HerdrError(self.fail)
        return {"workspaces": [{"workspace_id": w, "label": label} for w, label in self.workspaces],
                "tabs": [{"tab_id": tab, "workspace_id": tab.split(":")[0], "label": label}
                         for tab, label in self.tabs]}

    def call(self, method, params=None):
        self.calls.append(method)
        return {}


def screen_rows(drawn):
    """The text of each row that a page drew, without colors and trailing spaces."""
    rows = {}
    for match in re.finditer(r"\x1b\[(\d+);1H((?:(?!\x1b\[\d+;1H|\x1b\[2J).)*)", drawn,
                             re.DOTALL):
        text = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", match.group(2))
        rows[int(match.group(1))] = text.rstrip()
    return [rows.get(row, "") for row in range(1, max(rows, default=0) + 1)]


def picker_labels(rows):
    """The popup labels in the rows of a picker page."""
    return [row.split("─ ", 1)[1][2:].split()[0] for row in rows if "─ " in row]


# A popup for the scrollback tests: only its pane id counts.
SCROLLBACK_POPUP = popups.LivePopup({"pane_id": "w1:p1"}, None)


class RelayCase(unittest.TestCase):
    """The proxy with a pipe as the popup input, fake viewers, and a fake popup session.

    Workspace popups "p" (workspace w1) and "q" (workspace w2) run, with
    toggle key ctrl+z. Their labels are their ids.
    """

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.trace = pathlib.Path(folder.name) / "trace.txt"
        patch(self, mock.patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=folder.name,
                                    TOGGLE_POPUP_TRACE=str(self.trace)))
        self.input_read, self.input_write = os.pipe()
        self.output_read, self.output = os.pipe()
        os.set_blocking(self.output_read, False)
        self.main = FakeMain()
        # The sweep in the picker asks each owner session for its workspaces and tabs.
        self.owners = FakeOwners()
        self.owners.sessions[self.main.endpoint] = [tab for tab, _ in self.main.tabs]
        patch(self, mock.patch.object(popups, "Herdr", self.owners))
        self.session = FakePopupSession()
        for workspace_id, popup_id in (("w1", "p"), ("w2", "q")):
            self.add_popup(popup_id, "workspace", workspace_id=workspace_id,
                           backing=workspace_id, toggle_keys=["ctrl+z"])
        self.popup = proxy.Proxy("p", ["ctrl+b"], [], self.main, self.session,
                                 stdin=self.input_read, stdout=self.output)
        # relay() sets the record of the popup that shows. Page tests start without relay().
        self.popup.record = popups.load_record("p")
        self.fds = [self.input_read, self.input_write, self.output_read, self.output,
                    self.popup.wake_read, self.popup.wake_write]
        self.addCleanup(lambda: [os.close(fd) for fd in self.fds if fd is not None])
        # Plans for the next fake viewers: keyword arguments of FakeViewer.
        self.plans = []
        self.viewers = []
        patch(self, mock.patch.object(proxy, "Viewer", self.make_viewer))
        self.viewer = self.make_viewer("term-w1")
        self.popup.viewer = self.viewer
        self.stop = threading.Event()

    def add_popup(self, popup_id, scope, label=None, socket=None, backing=None, command=None,
                  toggle_keys=(), **owner):
        """Add a live popup of the main session (or of `socket`) with its record."""
        backing = backing or f"b-{popup_id}"
        self.session.add(backing, popup_id)
        popups.save_record(PopupRecord(popup_id, scope, label or popup_id, f"term-{backing}",
                                       command, list(toggle_keys),
                                       Owner(socket or self.main.endpoint, **owner)))

    def make_viewer(self, terminal_id, size_fd=0):
        viewer = FakeViewer(terminal_id, size_fd,
                            **(self.plans.pop(0) if self.plans else {}))
        self.viewers.append(viewer)
        self.addCleanup(viewer.close)
        return viewer

    def close_fd(self, fd):
        os.close(fd)
        self.fds[self.fds.index(fd)] = None

    def drawn(self):
        """The text that the proxy wrote to the popup terminal so far."""
        try:
            return os.read(self.output_read, 1 << 20).decode()
        except BlockingIOError:
            return ""

    def events(self):
        return self.trace.read_text().split() if self.trace.exists() else []

    def start(self, key_filter, chatty=False):
        """Run view() in a thread. A chatty viewer writes output every millisecond."""
        viewer = self.viewer

        def chatter():
            while not self.stop.wait(0.001):
                viewer.peer.sendall(b"x")
                self.drawn()

        threads = [threading.Thread(target=self.popup.view, args=(key_filter,), daemon=True)]
        if chatty:
            threads.append(threading.Thread(target=chatter, daemon=True))
        for thread in threads:
            thread.start()

        def finish():
            self.stop.set()
            for thread in threads[1:]:
                thread.join(5)
            viewer.peer.shutdown(socket.SHUT_RDWR)
            threads[0].join(5)
        self.addCleanup(finish)

    def received(self, size, seconds=2.0):
        """The first `size` bytes that the proxy sends to the viewer, or fewer after `seconds`."""
        data = b""
        deadline = time.monotonic() + seconds
        while len(data) < size and time.monotonic() < deadline:
            self.viewer.peer.settimeout(max(deadline - time.monotonic(), 0.001))
            try:
                data += self.viewer.peer.recv(size - len(data))
            except TimeoutError:
                break
        return data

    def next_viewer(self):
        """Start a new fake viewer, as the proxy does after a popup page."""
        self.viewer = self.make_viewer("term-w1")
        self.popup.viewer = self.viewer

    def live(self, popup_id):
        """The LivePopup of a popup, as relay() gives it to act()."""
        return popups.live_popups(self.session.snapshot())[popup_id]

    def key_filter(self, toggle_keys=()):
        return keys.KeyFilter(["ctrl+b"], list(toggle_keys), held=self.popup.input.held)

    def relay(self):
        """Run Proxy.relay() in a thread, with a time limit."""
        errors = []

        def target():
            try:
                self.popup.relay()
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=target, daemon=True)
        thread.start()
        thread.join(10)
        self.assertFalse(thread.is_alive(), "relay() did not return")
        if errors:
            raise errors[0]


class Relay(RelayCase):
    def test_a_lone_escape_is_sent_soon_while_the_program_prints(self):
        # Before the fix, the Esc waited for the next key while output came.
        self.start(self.key_filter(["alt+y"]), chatty=True)
        time.sleep(0.05)
        os.write(self.input_write, b"\x1b")
        self.assertEqual(self.received(1, seconds=1.0), b"\x1b")

    def test_input_after_a_popup_key_goes_to_the_next_viewer(self):
        os.write(self.input_write, b"ab\x1acd")
        self.assertIs(self.popup.view(self.key_filter(["ctrl+z"])), Action.HIDE)
        self.assertEqual(self.received(2), b"ab")
        self.next_viewer()
        self.start(self.key_filter())
        self.assertEqual(self.received(2), b"cd")

    def test_input_after_the_help_key_goes_to_the_help_page(self):
        os.write(self.input_write, b"\x02?x")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        page = self.popup.key_filter(to_program=False)
        self.assertEqual(self.popup.screen.read_key(page), Combo("x", 0))


class Pages(RelayCase):
    """The help page and the picker: popup keys act, other keys stay out of the program."""

    def test_another_key_closes_help_and_does_not_reach_the_program(self):
        os.write(self.input_write, b"\x02?xy")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        self.assertIs(self.popup.act(Action.HELP, self.live("p")), Next.SHOW)
        self.next_viewer()
        self.start(self.key_filter())
        self.assertEqual(self.received(2, seconds=0.5), b"y")

    def test_prefix_q_on_the_help_page_kills_the_popup(self):
        os.write(self.input_write, b"\x02?\x02q")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        self.assertIs(self.popup.act(Action.HELP, self.live("p")), Next.CLOSE)
        self.assertEqual(self.session.closed, ["w1"])
        self.assertEqual(self.events()[-2:], ["p", "kill"])

    def test_a_toggle_key_on_a_page_hides_the_popup(self):
        for page, keys_in in ((Action.HELP, b"\x1a"), (Action.PICKER, b"j\x1a")):
            with self.subTest(page=page):
                self.main.calls.clear()
                os.write(self.input_write, keys_in)
                self.assertIs(self.popup.act(page, self.live("p")), Next.CLOSE)
                self.assertEqual(self.main.calls, ["popup.close"])

    def test_prefix_question_mark_on_the_help_page_only_closes_help(self):
        os.write(self.input_write, b"\x02?\x02?y")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        self.assertIs(self.popup.act(Action.HELP, self.live("p")), Next.SHOW)
        self.next_viewer()
        self.start(self.key_filter())
        self.assertEqual(self.received(1, seconds=0.5), b"y")
        # Help closed without an action: the popup stays open.
        self.assertEqual((self.events(), self.main.calls), ([], []))

    def test_prefix_g_on_the_help_page_opens_the_picker(self):
        os.write(self.input_write, b"\x02?\x02g\x1b")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        self.drawn()
        self.assertIs(self.popup.act(Action.HELP, self.live("p")), Next.SHOW)
        self.assertTrue(screen_rows(self.drawn())[0].startswith(" Switch popup:"))
        self.assertEqual(self.events()[-2:], ["p", "picker"])

    def test_prefix_e_on_the_help_page_opens_the_scrollback(self):
        self.popup.scrollback = ["prefix+e"]
        edited = []
        patch(self, mock.patch.object(self.popup, "edit_scrollback", edited.append))
        os.write(self.input_write, b"\x02?\x02e")
        self.assertIs(self.popup.view(self.key_filter()), Action.HELP)
        self.assertIs(self.popup.act(Action.HELP, self.live("p")), Next.SHOW)
        self.assertEqual(edited, [self.session.pane("w1")])
        self.assertEqual(self.events()[-2:], ["p", "scrollback"])

    def test_the_help_page_names_the_popup_by_its_label(self):
        self.add_popup("a3f9c2", "workspace", "floating", workspace_id="w1")
        self.popup.popup_id = "a3f9c2"
        self.popup.record = popups.load_record("a3f9c2")
        os.write(self.input_write, b"x")
        self.assertIsNone(self.popup.help())
        self.assertEqual(screen_rows(self.drawn())[0], " Popup floating (a3f9c2)")

    def test_the_picker_groups_this_sessions_popups(self):
        # Popups of another session never show, even with the same workspace ids.
        other = "/x/sessions/other/herdr.sock"
        self.owners.sessions[other] = ["w1", "w2"]
        self.add_popup("o1", "workspace", "theirs", socket=other, workspace_id="w1")
        self.add_popup("o2", "session", "their-session", socket=other)
        home = os.path.expanduser("~")
        self.add_popup("s1", "session", "notes", command=["nvim", "notes.md"])
        self.add_popup("d1", "pwd", "lazygit", command=["lazygit"],
                       folder=os.path.join(home, "proj"))
        self.add_popup("t1", "tab", "htop", command=["htop"], workspace_id="w1",
                       tab_id="w1:t2")
        os.write(self.input_write, b"\x1b")
        self.assertEqual(self.popup.pick(), (None, False))
        self.assertEqual(screen_rows(self.drawn())[:10], [
            " Switch popup: j/k or arrows to move, enter to show, esc to stay", "",
            " work",
            "   ├─   lazygit  ~/proj    lazygit",
            "   └─   notes              nvim notes.md",
            " home",
            "   ├─   htop     tab logs  htop",
            "   └─ * p                  shell",
            " notes",
            "   └─   q                  shell"])

    def test_the_picker_names_the_default_shell_as_the_label_does(self):
        self.popup.default_shell = "nu"
        os.write(self.input_write, b"\x1b")
        self.popup.pick()
        self.assertEqual(screen_rows(self.drawn())[2:6],
                         [" home", "   └─ * p  nu", " notes", "   └─   q  nu"])

    def test_a_picker_switch_shows_the_chosen_popup(self):
        os.write(self.input_write, b"j\r")
        self.assertEqual(self.popup.pick(), (None, True))
        self.assertEqual(self.popup.popup_id, "q")
        self.assertEqual(self.events()[-2:], ["q", "switch"])

    def test_the_picker_sweeps_popups_whose_owner_is_gone(self):
        # Workspace w3 and tab w1:t9 closed, and their hooks did not run.
        self.add_popup("r", "workspace", workspace_id="w3")
        self.add_popup("t", "tab", workspace_id="w1", tab_id="w1:t9")
        os.write(self.input_write, b"\x1b")
        self.popup.pick()
        self.assertEqual(sorted(self.session.closed), ["b-r", "b-t"])
        self.assertEqual(picker_labels(screen_rows(self.drawn())), ["p", "q"])

    def test_a_failed_sweep_is_only_logged_and_the_picker_shows(self):
        # The sweep is housekeeping: its error must not close the popup. It
        # can come from Herdr, the state folder, or a record file.
        cases = {
            herdr_api.HerdrError("workspace.close: timed out"): "workspace.close: timed out",
            PermissionError(13, "Permission denied"):
                "PermissionError: [Errno 13] Permission denied",
            ValueError("bad record"): "bad record",
        }
        toasts = []
        patch(self, mock.patch.object(herdr_api, "report_error",
                                      lambda *args, **kwargs: toasts.append(args)))
        for error, text in cases.items():
            with self.subTest(error=type(error).__name__):
                def sweep(herdr, owner_timeout, error=error):
                    raise error

                os.write(self.input_write, b"\x1b")
                with mock.patch.object(popups, "sweep", sweep), \
                        mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
                    self.assertEqual(self.popup.pick(), (None, False))
                self.assertEqual(picker_labels(screen_rows(self.drawn())), ["p", "q"])
                self.assertEqual(stderr.getvalue(), f"toggle-popup: sweep: {text}\n")
                self.assertEqual(toasts, [])

    def test_without_the_main_session_the_picker_shows_workspace_and_tab_ids(self):
        self.main.fail = "no answer"
        self.owners.slow.add(self.main.endpoint)
        self.add_popup("t", "tab", workspace_id="w1", tab_id="w1:t2")
        os.write(self.input_write, b"\x1b")
        self.popup.pick()
        rows = screen_rows(self.drawn())
        self.assertIn(" w1", rows)
        self.assertIn(" w2", rows)
        self.assertIn("   └─   t  tab w1:t2  shell", rows)

    def test_the_enter_release_after_a_switch_does_not_reach_the_new_viewer(self):
        # Kitty report-all-keys mode: a quick picker switch, all in one read.
        def press_release(code, mods=1):
            return f"\x1b[{code};{mods}:1u\x1b[{code};{mods}:3u".encode()

        a_key = press_release(97)
        os.write(self.input_write, press_release(98, 5) + press_release(103) + press_release(106)
                 + press_release(13) + a_key)
        self.assertIs(self.popup.view(self.key_filter()), Action.PICKER)
        self.assertEqual(self.popup.pick(), (None, True))
        self.assertEqual(self.popup.popup_id, "q")
        self.next_viewer()
        self.start(self.key_filter())
        self.assertEqual(self.received(len(a_key)), a_key)


class WindowSize(RelayCase):
    def test_a_resize_redraws_the_page(self):
        sizes = [(24, 40), (24, 60)]
        patch(self, mock.patch.object(proxy.Screen, "size", lambda screen: sizes[0]))
        self.popup.screen.draw([("row", True)])
        sizes.pop(0)
        os.write(self.popup.wake_write, b"w")
        os.write(self.input_write, b"x")
        self.assertEqual(self.popup.screen.read_key(self.popup.key_filter(to_program=False)),
                         Combo("x", 0))
        drawn = self.drawn()
        self.assertEqual(drawn.count("\x1b[?1049h"), 2)
        self.assertIn("row".ljust(60), drawn.rsplit("\x1b[?1049h", 1)[1])

    def test_a_resize_signal_with_a_full_wake_pipe_is_no_error(self):
        # Many SIGWINCH signals while the relay loop is busy fill the pipe.
        with contextlib.suppress(BlockingIOError):
            while True:
                os.write(self.popup.wake_write, b"w" * 4096)
        self.popup.wake()


class EndedViewer(RelayCase):
    def test_input_for_a_viewer_that_ended_is_no_error(self):
        # The program exited; the viewer's pseudo-terminal is gone before its end shows.
        self.viewer.peer.close()
        os.write(self.input_write, b"abc")
        self.popup.input.read()
        self.assertIsNone(self.popup.view(self.key_filter()))


class ClosedPopup(RelayCase):
    """After Herdr closes the popup, the proxy writes nothing and starts no viewer."""

    def test_the_end_of_input_on_a_page_closes_the_popup(self):
        os.write(self.input_write, b"\x02?")
        self.close_fd(self.input_write)
        self.popup.viewer = None
        self.relay()
        self.assertEqual(len(self.viewers), 2)  # the setUp viewer, and the one of relay()
        self.assertEqual(self.events(), ["p", "open", "p", "help"])

    def test_a_write_to_a_closed_popup_terminal_is_no_error(self):
        os.write(self.input_write, b"\x02?")
        self.close_fd(self.output_read)
        self.popup.viewer = None
        self.relay()
        self.assertEqual(len(self.viewers), 2)
        self.assertTrue(self.popup.input.ended)


class WakePipe(unittest.TestCase):
    def test_run_closes_the_wake_pipe_at_its_end(self):
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        popup = proxy.Proxy("p", ["ctrl+b"], [], None, None, stdin=terminal, stdout=terminal)
        before = signal.getsignal(signal.SIGWINCH)
        self.addCleanup(signal.signal, signal.SIGWINCH, before)
        for signum in proxy.HANG_UP_SIGNALS:
            self.addCleanup(signal.signal, signum, signal.getsignal(signum))
        with mock.patch.object(popup, "relay", lambda: None):
            popup.run()
        for fd in (popup.wake_read, popup.wake_write):
            with self.assertRaises(OSError) as raised:
                os.fstat(fd)
            self.assertEqual(raised.exception.errno, errno.EBADF)
        # A late SIGWINCH does not write to a closed pipe.
        self.assertEqual(signal.getsignal(signal.SIGWINCH), signal.SIG_DFL)


class Attaches(RelayCase):
    """The viewers that the proxy starts."""

    def test_after_a_picker_switch_the_other_popup_shows(self):
        self.plans = [{}, {"ended": True, "end": (0, "")}]
        os.write(self.input_write, b"\x02gj\r")
        self.popup.viewer = None
        self.relay()
        self.assertEqual([viewer.terminal_id for viewer in self.viewers[1:]],
                         ["term-w1", "term-w2"])

    def test_a_busy_terminal_is_attached_again(self):
        busy = "herdr: server shut down: terminal attach failed: terminal x has a read in" \
               " progress; retry\n"
        self.plans = [{"ended": True, "end": (1, busy)}, {"ended": True, "end": (0, "")}]
        self.popup.viewer = None
        patch(self, mock.patch.object(proxy, "ATTACH_RETRY_SECONDS", 0.01))
        self.relay()
        self.assertEqual(len(self.viewers), 3)
        self.assertEqual(self.events()[-2:], ["p", "viewer-ended"])

    def test_the_viewer_gets_the_size_of_the_popup_terminal(self):
        # Not the size of fd 0: the proxy can run with another terminal there.
        self.plans = [{"ended": True, "end": (0, "")}]
        self.popup.viewer = None
        self.relay()
        self.assertEqual(self.viewers[1].size_fd, self.input_read)


class InputDeadline(unittest.TestCase):
    def setUp(self):
        read, self.write = os.pipe()
        self.addCleanup(os.close, read)
        self.addCleanup(os.close, self.write)
        self.input = proxy.Input(read)

    def feed(self, data):
        os.write(self.write, data)
        self.assertTrue(self.input.read())

    def test_an_unfinished_sequence_keeps_its_first_deadline(self):
        self.feed(b"\x1b[1")
        first = self.input.deadline
        self.feed(b";5")
        self.assertEqual(self.input.deadline, first)
        self.feed(b"A")
        self.assertIsNone(self.input.deadline)
        self.assertEqual([token.raw for token in self.input.tokens], [b"\x1b[1;5A"])

    def test_a_new_unfinished_sequence_gets_a_new_deadline(self):
        self.feed(b"\x1b")
        old = time.monotonic() - 100
        self.input.deadline = old
        self.feed(b"a\x1b")
        self.assertGreater(self.input.deadline, old + 50)

    def test_a_paste_has_no_deadline(self):
        self.feed(b"\x1b[200~abc\x1b[20")
        self.assertIsNone(self.input.deadline)
        self.assertIsNone(self.input.timeout())

    def test_after_the_deadline_a_lone_escape_is_the_esc_key(self):
        self.feed(b"\x1b")
        self.input.expire()
        self.assertEqual(list(self.input.tokens), [])
        self.assertLessEqual(self.input.timeout(), proxy.ESCAPE_SECONDS)
        self.input.deadline = time.monotonic()
        self.input.expire()
        self.assertEqual([token.key.name for token in self.input.tokens], ["esc"])
        self.assertIsNone(self.input.deadline)

    def test_a_key_after_the_deadline_is_not_joined_to_a_lone_escape(self):
        # A busy screen kept the proxy away until after the deadline: Esc, then y.
        self.feed(b"\x1b")
        self.input.deadline = time.monotonic() - 1
        self.feed(b"y")
        self.assertEqual([token.raw for token in self.input.tokens], [b"\x1b", b"y"])

    def test_discard_drops_the_input_that_waits(self):
        self.feed(b"G\x1b[1")
        self.input.discard()
        self.assertEqual((list(self.input.tokens), self.input.tokenizer.pending,
                          self.input.deadline), ([], b"", None))


class PickerGroups(unittest.TestCase):
    A, B = "/x/a.sock", "/x/b.sock"

    def record(self, popup_id, scope, socket, label=None, **owner):
        return PopupRecord(popup_id, scope, label or popup_id, "t", None, [],
                           Owner(socket, **owner))

    def records(self, *items):
        return {item.id: item for item in items}

    def test_session_popups_first_then_workspaces_in_the_session_order(self):
        records = self.records(
            self.record("ws1", "workspace", self.A, workspace_id="w1"),
            self.record("tab2", "tab", self.A, workspace_id="w2", tab_id="w2:t3"),
            self.record("ws2", "workspace", self.A, workspace_id="w2"),
            self.record("pwd", "pwd", self.A, folder="/p"),
            self.record("sess", "session", self.A),
            self.record("theirs", "workspace", self.B, workspace_id="w1"),
            self.record("their-session", "session", self.B))
        groups = proxy.picker_groups(records, self.A, "work", [("w2", "two"), ("w1", "one")])
        self.assertEqual(groups, [("work", ["pwd", "sess"]), ("two", ["tab2", "ws2"]),
                                  ("one", ["ws1"])])

    def test_a_group_is_in_label_order(self):
        records = self.records(self.record("x1", "session", self.A, "yazi"),
                               self.record("x2", "pwd", self.A, "lazygit", folder="/p"),
                               self.record("x3", "pwd", self.A, "lazygit", folder="/a"))
        self.assertEqual(proxy.picker_groups(records, self.A, "work", []),
                         [("work", ["x2", "x3", "x1"])])

    def test_an_unknown_workspace_is_a_group_under_its_id_at_the_end(self):
        # The session did not answer, or the workspace closed a moment ago.
        records = self.records(self.record("x", "workspace", self.A, workspace_id="w9"),
                               self.record("y", "workspace", self.A, workspace_id="w1"),
                               self.record("z", "tab", self.A, workspace_id="w5", tab_id="w5:t1"))
        self.assertEqual(proxy.picker_groups(records, self.A, "work", [("w1", "one")]),
                         [("one", ["y"]), ("w5", ["z"]), ("w9", ["x"])])
        self.assertEqual(proxy.picker_groups(records, self.A, "work", None),
                         [("w1", ["y"]), ("w5", ["z"]), ("w9", ["x"])])

    def test_no_popups_give_no_groups(self):
        self.assertEqual(proxy.picker_groups({}, self.A, "work", [("w1", "one")]), [])


class TraceEvents(unittest.TestCase):
    """The trace holds event names only, never typed input."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = pathlib.Path(folder.name) / "trace.txt"
        patch(self, mock.patch.dict(os.environ, TOGGLE_POPUP_TRACE=str(self.path)))

    def test_an_event_is_one_line_with_the_popup_id(self):
        proxy.trace_event("work/w1/floating", "toggle-key")
        proxy.trace_event("work/w1/floating", "viewer-ended")
        self.assertEqual(self.path.read_text(),
                         "work/w1/floating\ttoggle-key\nwork/w1/floating\tviewer-ended\n")

    def test_text_that_is_not_an_event_name_is_refused(self):
        for text in ("hunter2", "68 75 6e", "toggle-key hunter2", ""):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    proxy.trace_event("p", text)
        self.assertFalse(self.path.exists())

    def test_no_trace_without_the_variable(self):
        del os.environ["TOGGLE_POPUP_TRACE"]
        proxy.trace_event("p", "toggle-key")
        self.assertFalse(self.path.exists())


class HelpRows(unittest.TestCase):
    def rows(self, prefix):
        return dict(proxy.help_rows(prefix, ["ctrl+z", "prefix+f"], ["prefix+e", ""]))

    def test_every_prefix_command_has_its_row(self):
        rows = self.rows(["ctrl+;"])
        self.assertEqual(rows["ctrl+z, prefix f"], "hide this popup")
        for combo, action in keys.PREFIX_COMMANDS:
            with self.subTest(action=action):
                self.assertEqual(rows[f"prefix {combo.label}"], proxy.ACTIONS[action].help)
        self.assertEqual(rows["prefix e"], proxy.ACTIONS[Action.SCROLLBACK].help)
        self.assertEqual(rows["prefix prefix"], "send the prefix key to the program")

    def test_a_prefix_key_reads_as_the_parser_reads_it(self):
        self.assertEqual(proxy.key_label(" Prefix+e"), "prefix e")
        self.assertEqual(proxy.key_label("ctrl+z"), "ctrl+z")
        self.assertEqual(keys.split_prefix(" Prefix+e"), (True, "e"))

    def test_the_viewer_close_key_shows_only_when_no_prefix_takes_it(self):
        self.assertIn("ctrl+b q", self.rows(["ctrl+;"]))
        self.assertNotIn("ctrl+b q", self.rows(["ctrl+b"]))
        self.assertNotIn("ctrl+b q", self.rows(["ctrl+a", "CTRL+b"]))


class ScrollbackRead(unittest.TestCase):
    def test_bytes_that_are_not_utf8_become_replacement_characters(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        herdr = pathlib.Path(folder.name) / "herdr"
        herdr.write_text("#!/bin/sh\nprintf 'ok \\377\\376 \\303\\251\\n'\n")
        herdr.chmod(herdr.stat().st_mode | stat.S_IXUSR)
        patch(self, mock.patch.dict(os.environ, HERDR_BIN_PATH=str(herdr)))
        self.assertEqual(proxy.read_scrollback("w1:p1"), "ok �� é\n")


class ViewerEnds(unittest.TestCase):
    """How the proxy tells why a viewer ended by itself."""

    TAKEN = "herdr: server shut down: terminal attach taken over\n"
    EXITED = "herdr: server shut down: terminal term-1 exited\n"
    REFUSED = ("herdr: server shut down: terminal attach failed: terminal term-1 already has"
               " an attached client; retry with --takeover\n")

    def event(self, status, errors, gone=False):
        return proxy.viewer_end(status, errors, "term-1", lambda: gone)

    def test_a_detach_is_a_quiet_close(self):
        self.assertIs(self.event(0, "herdr: detached from server\n"), ViewerEnd.CLOSED)

    def test_a_takeover_by_another_viewer_is_a_quiet_close(self):
        self.assertIs(self.event(1, self.TAKEN), ViewerEnd.TAKEN_OVER)

    def test_a_program_exit_is_a_quiet_close(self):
        self.assertIs(self.event(1, self.EXITED), ViewerEnd.CLOSED)
        self.assertIs(self.event(1, "", gone=True), ViewerEnd.CLOSED)

    def test_a_failed_attach_is_an_error_with_herdrs_reason(self):
        with self.assertRaisesRegex(herdr_api.HerdrError,
                                    "^cannot show the popup: server shut down: terminal attach "
                                    "failed: .*retry with --takeover$"):
            self.event(1, self.REFUSED)
        with self.assertRaisesRegex(herdr_api.HerdrError, "exit status -15"):
            self.event(-15, "")


    def test_a_busy_terminal_is_attached_again_a_few_times(self):
        busy = "herdr: server shut down: terminal attach failed: terminal term-1 has a read in" \
               " progress; retry\n"
        self.assertIs(proxy.viewer_end(1, busy, "term-1", lambda: False, can_retry=True),
                      ViewerEnd.BUSY)
        with self.assertRaisesRegex(herdr_api.HerdrError, "read in progress"):
            proxy.viewer_end(1, busy, "term-1", lambda: False, can_retry=False)


class WindowSizes(unittest.TestCase):
    def test_a_terminal_without_a_size_yet_gets_the_default_size(self):
        # A new popup can start before Herdr sets its size. The viewer
        # refuses a zero-sized grid; SIGWINCH brings the real size later.
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
        self.assertEqual(struct.unpack("HHHH", proxy.window_size(terminal))[:2], (24, 80))
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
        self.assertEqual(struct.unpack("HHHH", proxy.window_size(terminal))[:2], (30, 100))

    def test_the_pages_have_the_size_of_the_popup_terminal(self):
        # Not the size of fd 0: a test runner or a shell can hold another terminal there.
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
        self.assertEqual(proxy.Screen(proxy.Input(terminal)).size(), (30, 100))
        read, write = os.pipe()
        self.addCleanup(os.close, read)
        self.addCleanup(os.close, write)
        self.assertEqual(proxy.Screen(proxy.Input(read)).size(), (24, 80))


class ClosedTerminal(unittest.TestCase):
    def test_the_errors_of_a_terminal_that_is_gone(self):
        for error, closed in ((OSError(errno.EIO, "Input/output error"), True),
                              (BrokenPipeError(errno.EPIPE, "Broken pipe"), True),
                              (termios.error(errno.ENXIO, "Device not configured"), True),
                              (termios.error(errno.EBADF, "Bad file descriptor"), True),
                              (OSError(errno.EACCES, "Permission denied"), False),
                              (termios.error(errno.EINVAL, "Invalid argument"), False),
                              (termios.error("no errno"), False)):
            with self.subTest(error=error):
                self.assertIs(proxy.closed_terminal(error), closed)


class Nudges(unittest.TestCase):
    """AttachNudge wakes the popup server on the first output, and again until the frame."""

    def setUp(self):
        self.sent = []
        self.nudge = proxy.AttachNudge(lambda: self.sent.append(True))

    def test_nothing_is_sent_before_the_first_output(self):
        self.assertIsNone(self.nudge.timeout(0.0))
        self.nudge.tick(10.0)
        self.assertEqual(self.sent, [])

    def test_the_first_output_sends_once_and_a_frame_stops_the_rest(self):
        self.nudge.output(1.0)
        # The terminal setup can come in more than one read, in one burst.
        self.nudge.output(1.001)
        self.assertEqual(len(self.sent), 1)
        self.assertAlmostEqual(self.nudge.timeout(1.001), 0.024)
        self.nudge.output(1.010)
        self.assertIsNone(self.nudge.timeout(1.010))
        self.nudge.tick(2.0)
        self.assertEqual(len(self.sent), 1)

    def test_without_a_frame_it_sends_again_twice_then_stops(self):
        self.nudge.output(1.0)
        self.nudge.tick(1.020)
        self.assertEqual(len(self.sent), 1)
        self.nudge.tick(1.025)
        self.assertEqual(len(self.sent), 2)
        self.assertAlmostEqual(self.nudge.timeout(1.025), 0.025)
        self.nudge.tick(1.050)
        self.assertEqual(len(self.sent), 3)
        self.assertIsNone(self.nudge.timeout(1.050))
        self.nudge.tick(5.0)
        self.assertEqual(len(self.sent), 3)


class ViewerProcess(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        patch(self, mock.patch.dict(os.environ, HERDR_BIN_PATH=str(self.folder / "herdr")))
        # A nudge must not reach a real popup server.
        self.nudges = []
        server = mock.Mock()
        server.nudge.side_effect = self.nudges.append
        patch(self, mock.patch.object(herdr_api, "popup_herdr", lambda timeout=5.0: server))

    def test_the_first_output_nudges_the_popup_server(self):
        self.fake_herdr("printf screen\n")
        output, _ = self.run_viewer()
        self.assertEqual(output, b"screen")
        self.assertEqual(self.nudges, ["workspace.list"])

    def fake_herdr(self, script):
        herdr = self.folder / "herdr"
        herdr.write_text("#!/bin/sh\n" + script)
        herdr.chmod(herdr.stat().st_mode | stat.S_IXUSR)

    def run_viewer(self, size_fd=None):
        """Run a viewer to its end. By default its size comes from a pipe: 80x24."""
        if size_fd is None:
            size_fd, write = os.pipe()
            self.addCleanup(os.close, size_fd)
            self.addCleanup(os.close, write)
        viewer = proxy.Viewer("term-1", size_fd)
        output = b""
        while True:
            data = viewer.read()
            if not data:
                break
            output += data
        return output, viewer.finish()

    def test_the_viewer_takes_over_and_keeps_stderr_apart_from_its_screen(self):
        self.fake_herdr(f'printf "%s\\n" "$*" > {self.folder}/argv\n'
                        f'printf "%s\\n" "$HERDR_SOCKET_PATH" > {self.folder}/socket\n'
                        'printf screen\nprintf "herdr: taken over\\n" >&2\nexit 1\n')
        output, (status, errors) = self.run_viewer()
        self.assertEqual((self.folder / "argv").read_text(),
                         "terminal attach term-1 --takeover\n")
        # The popup session's environment, from the one command builder.
        self.assertEqual((self.folder / "socket").read_text(),
                         f"{herdr_api.session_socket(herdr_api.POPUP_SESSION)}\n")
        self.assertEqual(output, b"screen")
        self.assertEqual((status, errors), (1, "herdr: taken over\n"))

    def popup_terminal(self, rows, cols):
        """A terminal of a given size, as the popup terminal of the proxy."""
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        return terminal

    def test_the_viewer_has_its_size_when_it_starts(self):
        # Herdr's attach client reads its grid size at once and refuses 0x0.
        self.fake_herdr(f"stty size > {self.folder}/size\n")
        # The size must not depend on the proxy: on a busy machine the viewer
        # runs first. Here the proxy never sets it after the start.
        with mock.patch.object(proxy.Viewer, "resize", lambda viewer: None):
            self.run_viewer(size_fd=self.popup_terminal(33, 77))
        self.assertEqual((self.folder / "size").read_text(), "33 77\n")

    def test_a_resize_gives_the_viewer_the_new_size_of_the_popup_terminal(self):
        self.fake_herdr("sleep 5\n")
        terminal = self.popup_terminal(33, 77)
        viewer = proxy.Viewer("term-1", terminal)
        self.addCleanup(viewer.stop)
        fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 90, 0, 0))
        viewer.resize()
        size = fcntl.ioctl(viewer.fd, termios.TIOCGWINSZ, b"\0" * 8)
        self.assertEqual(struct.unpack("HHHH", size)[:2], (40, 90))

    def test_a_failed_fork_closes_the_stderr_pipe(self):
        before = len(os.listdir("/dev/fd"))
        with mock.patch.object(proxy.pty, "fork", side_effect=OSError("no ptys")):
            with self.assertRaisesRegex(OSError, "no ptys"):
                proxy.Viewer("term-1")
        self.assertEqual(len(os.listdir("/dev/fd")), before)

    def test_a_viewer_that_cannot_start_reports_why(self):
        os.environ["HERDR_BIN_PATH"] = str(self.folder / "missing")
        _, (status, errors) = self.run_viewer()
        self.assertEqual(status, 127)
        self.assertIn("cannot run", errors)


class ScrollbackErrors(unittest.TestCase):
    def test_a_failed_read_is_a_toast_and_the_popup_stays(self):
        toasts = []

        class Main:
            def __init__(self, endpoint, timeout=5.0):
                self.endpoint = endpoint

            def notify(self, title, body):
                toasts.append((self.endpoint, body))

        def fail(pane_id):
            raise herdr_api.HerdrError("pane read: no such pane")

        patch(self, mock.patch.object(herdr_api, "Herdr", Main))
        patch(self, mock.patch.object(proxy, "read_scrollback", fail))
        popup = proxy.Proxy("p", ["ctrl+b"], [], Main("/x/main.sock"), None)
        self.addCleanup(os.close, popup.wake_read)
        self.addCleanup(os.close, popup.wake_write)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertIs(popup.act(Action.SCROLLBACK, SCROLLBACK_POPUP), Next.SHOW)
        self.assertEqual(toasts, [("/x/main.sock", "pane read: no such pane")])
        self.assertIn("scrollback: pane read: no such pane", stderr.getvalue())


class ScrollbackInput(unittest.TestCase):
    def test_keys_typed_before_the_editor_do_not_reach_it_or_the_program(self):
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        # TCSAFLUSH waits until the terminal output is read: write it elsewhere.
        output = os.open(os.devnull, os.O_WRONLY)
        self.addCleanup(os.close, output)
        popup = proxy.Proxy("p", ["ctrl+b"], [], FakeMain(), None, stdin=terminal,
                            stdout=output)
        self.addCleanup(os.close, popup.wake_read)
        self.addCleanup(os.close, popup.wake_write)
        popup.cooked = termios.tcgetattr(terminal)
        tty.setraw(terminal)
        os.write(main, b"G")
        popup.input.read()
        self.assertEqual(len(popup.input.tokens), 1)
        queued = []

        def editor(path):
            queued.append(len(popup.input.tokens))

        patch(self, mock.patch.object(proxy, "read_scrollback", lambda pane_id: "text\n"))
        patch(self, mock.patch.object(proxy, "run_editor", editor))
        self.assertIs(popup.act(Action.SCROLLBACK, SCROLLBACK_POPUP), Next.SHOW)
        self.assertEqual(queued, [0])
        self.assertEqual(list(popup.input.tokens), [])


class ScrollbackClosedTerminal(unittest.TestCase):
    def test_a_popup_that_closes_while_the_editor_runs_closes_quietly(self):
        main, terminal = os.openpty()
        self.addCleanup(os.close, main)
        self.addCleanup(os.close, terminal)
        output = os.open(os.devnull, os.O_WRONLY)
        self.addCleanup(os.close, output)
        popup = proxy.Proxy("p", ["ctrl+b"], [], FakeMain(), None, stdin=terminal,
                            stdout=output)
        self.addCleanup(os.close, popup.wake_read)
        self.addCleanup(os.close, popup.wake_write)
        popup.cooked = termios.tcgetattr(terminal)
        real_tcsetattr = termios.tcsetattr
        closed = []

        def tcsetattr(fd, when, modes):
            # On Linux a terminal that Herdr closed gives EIO.
            if closed:
                raise termios.error(errno.EIO, "Input/output error")
            real_tcsetattr(fd, when, modes)

        def editor(path):
            closed.append(True)

        patch(self, mock.patch.object(proxy, "read_scrollback", lambda pane_id: "text\n"))
        patch(self, mock.patch.object(proxy, "run_editor", editor))
        patch(self, mock.patch.object(proxy.termios, "tcsetattr", tcsetattr))
        self.assertIs(popup.act(Action.SCROLLBACK, SCROLLBACK_POPUP), Next.CLOSE)
        self.assertTrue(popup.input.ended)


# A proxy in the scrollback editor, in a process of its own. It prints
# "toast" for each toast. Herdr ends a closed popup with signals to each
# process of the popup's session: the test sends them to the process group.
HANG_UP_PROXY = """
import os, pty, sys, termios, types
sys.path.insert(0, sys.argv[1])
import herdr_api, popups, proxy
from keys import Action
herdr_api.report_error = lambda *args: print("toast", flush=True)
proxy.read_scrollback = lambda pane_id: "secret\\n"
main, terminal = pty.openpty()
output = os.open(os.devnull, os.O_WRONLY)
popup = proxy.Proxy("p", ["ctrl+b"], [], types.SimpleNamespace(endpoint="/x"), None,
                    stdin=terminal, stdout=output)
popup.cooked = termios.tcgetattr(terminal)
popup.end_on_hang_up()
popup.act(Action.SCROLLBACK, popups.LivePopup({"pane_id": "w1:p1"}, None))
print("editor ended", flush=True)
"""


class ScrollbackHangUp(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = pathlib.Path(folder.name)
        editor = self.folder / "editor"
        # The editor gets "+" and the file. It ends on its own SIGHUP. Its
        # shell writes nothing about the end of its sleep.
        editor.write_text(f"""#!/bin/sh
exec 2>/dev/null
trap 'echo HUP > {self.folder}/caught; exit 0' HUP
echo "$2" > {self.folder}/file.tmp && mv {self.folder}/file.tmp {self.folder}/file
while :; do sleep 0.05; done
""")
        editor.chmod(0o700)
        env = dict(os.environ, EDITOR=str(editor), TMPDIR=str(self.folder))
        plugin = str(pathlib.Path(proxy.__file__).parent)
        self.proxy = subprocess.Popen(
            [sys.executable, "-I", "-B", "-c", HANG_UP_PROXY, plugin], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.addCleanup(self.kill_group)
        deadline = time.monotonic() + 10
        while not (self.folder / "file").exists():
            self.assertLess(time.monotonic(), deadline, "the editor did not start")
            self.assertIsNone(self.proxy.poll(), "the proxy ended before the editor started")
            time.sleep(0.01)
        self.path = pathlib.Path((self.folder / "file").read_text().strip())
        self.assertEqual(self.path.read_text(), "secret\n")

    def kill_group(self):
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(self.proxy.pid, signal.SIGKILL)
        self.proxy.communicate()

    def hang_up(self, *signals):
        for signum in signals:
            # macOS gives EPERM for a group that holds only a zombie.
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(self.proxy.pid, signum)
            time.sleep(0.05)
        return self.proxy.communicate(timeout=10)

    def test_herdr_closing_the_popup_removes_the_scrollback_file_quietly(self):
        output, errors = self.hang_up(signal.SIGHUP)
        self.assertFalse(self.path.exists())
        self.assertEqual((output, errors), ("", ""))
        self.assertEqual(self.proxy.returncode, 128 + signal.SIGHUP)
        # The editor ends by itself on its own SIGHUP.
        self.assertEqual((self.folder / "caught").read_text(), "HUP\n")

    def test_a_second_signal_does_not_stop_the_cleanup(self):
        # Herdr sends SIGTERM 250 ms after SIGHUP.
        output, errors = self.hang_up(signal.SIGHUP, signal.SIGTERM)
        self.assertFalse(self.path.exists())
        self.assertEqual((output, errors), ("", ""))

    def test_sigterm_alone_removes_the_scrollback_file_quietly(self):
        os.kill(self.proxy.pid, signal.SIGTERM)
        self.proxy.wait(10)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.proxy.returncode, 128 + signal.SIGTERM)
        # The editor stays until Herdr ends the processes of the closed popup.
        self.assertFalse((self.folder / "caught").exists())
        self.assertEqual(self.hang_up(signal.SIGHUP), ("", ""))


class Kill(unittest.TestCase):
    def test_kill_closes_the_popup_while_it_holds_the_popup_lock(self):
        held = []

        @contextlib.contextmanager
        def lock():
            held.append(True)
            yield
            held.append(False)

        def close(herdr, workspace_id, popup_id=None):
            self.assertEqual(held, [True])
            closed.append((workspace_id, popup_id))

        closed = []
        patch(self, mock.patch.object(popups, "popup_lock", lock))
        patch(self, mock.patch.object(popups, "close_popup", close))
        popup = proxy.Proxy("p", ["ctrl+b"], [], None, None)
        self.addCleanup(os.close, popup.wake_read)
        self.addCleanup(os.close, popup.wake_write)
        killed = popups.LivePopup({"workspace_id": "w1"}, None)
        self.assertIs(popup.act(Action.KILL, killed), Next.CLOSE)
        self.assertEqual(closed, [("w1", "p")])
        self.assertEqual(held, [True, False])


def fake_toasts(case):
    """Replace the Herdr client for one test. Return the list of (socket, toast text)."""
    toasts = []

    class Main:
        def __init__(self, endpoint, timeout=5.0):
            self.endpoint = endpoint

        def notify(self, title, body):
            toasts.append((self.endpoint, body))

    patch(case, mock.patch.object(herdr_api, "Herdr", Main))
    return toasts


class StartErrors(unittest.TestCase):
    """The proxy needs the environment that toggle_popup.py gives the popup."""

    ENV = {"HERDR_SOCKET_PATH": "/x/herdr/sessions/work/herdr.sock", "TOGGLE_POPUP_ID": "p",
           "TOGGLE_POPUP_PREFIX": '["ctrl+b"]', "TOGGLE_POPUP_SCROLLBACK": '["prefix+e"]',
           "TOGGLE_POPUP_MAIN_DEFAULT_SHELL": '"nu"'}

    def setUp(self):
        self.toasts = fake_toasts(self)
        patch(self, mock.patch.object(proxy.Proxy, "run",
                                      lambda popup: self.fail("the proxy must not start")))

    def run_main(self, **env):
        with mock.patch.dict(os.environ, env, clear=True):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                code = proxy.main()
        self.assertEqual(code, 1)
        return stderr.getvalue()

    def test_each_value_from_the_toggle_is_required(self):
        for name in self.ENV:
            with self.subTest(missing=name):
                env = {key: value for key, value in self.ENV.items() if key != name}
                self.assertIn(f"{name} is not set", self.run_main(**env))

    def test_without_a_session_socket_there_is_no_toast(self):
        env = dict(self.ENV)
        del env["HERDR_SOCKET_PATH"]
        self.run_main(**env)
        self.assertEqual(self.toasts, [])

    def test_the_proxy_starts_with_the_values_from_the_toggle(self):
        started = []
        with mock.patch.object(proxy.Proxy, "run", lambda popup: started.append(popup)):
            with mock.patch.dict(os.environ, self.ENV, clear=True):
                self.assertEqual(proxy.main(), 0)
        self.assertEqual([(popup.popup_id, popup.prefix, popup.scrollback, popup.default_shell,
                           popup.main.endpoint) for popup in started],
                         [("p", ["ctrl+b"], ["prefix+e"], "nu", self.ENV["HERDR_SOCKET_PATH"])])
        for popup in started:
            os.close(popup.wake_read)
            os.close(popup.wake_write)

    def test_with_a_session_socket_the_error_is_a_toast(self):
        env = dict(self.ENV, TOGGLE_POPUP_PREFIX="")
        self.run_main(**env)
        self.assertEqual(self.toasts, [(env["HERDR_SOCKET_PATH"], self.toasts[0][1])])
        self.assertIn("TOGGLE_POPUP_PREFIX is not set", self.toasts[0][1])


class InputErrors(unittest.TestCase):
    """Only a terminal that is gone ends the input. Another read error is a toast."""

    def setUp(self):
        self.toasts = fake_toasts(self)

    def read_error(self, error):
        """Run the proxy, whose first read of the popup input gets `error`."""
        real_read = os.read

        def read(fd, size):
            if fd == 0:
                raise error
            return real_read(fd, size)

        ends = []

        def run(popup):
            self.addCleanup(os.close, popup.wake_read)
            self.addCleanup(os.close, popup.wake_write)
            ends.append(popup.input.read())
            ends.append(popup.input.ended)

        patch(self, mock.patch.object(proxy.os, "read", read))
        patch(self, mock.patch.object(proxy.Proxy, "run", run))
        with mock.patch.dict(os.environ, StartErrors.ENV, clear=True):
            with contextlib.redirect_stderr(io.StringIO()) as stderr:
                code = proxy.main()
        return code, ends, stderr.getvalue()

    def test_an_unexpected_read_error_is_raised_and_shown(self):
        code, ends, stderr = self.read_error(OSError(errno.EINVAL, "Invalid argument"))
        self.assertEqual((code, ends), (1, []))
        self.assertIn("Invalid argument", stderr)
        self.assertEqual(len(self.toasts), 1)
        self.assertIn("Invalid argument", self.toasts[0][1])

    def test_a_terminal_that_is_gone_ends_the_input_quietly(self):
        code, ends, stderr = self.read_error(OSError(errno.EIO, "Input/output error"))
        self.assertEqual((code, ends, stderr, self.toasts), (0, [False, True], "", []))


if __name__ == "__main__":
    unittest.main()
