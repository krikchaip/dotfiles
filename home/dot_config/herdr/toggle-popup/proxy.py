"""Key-filter proxy: the program inside each Herdr popup.

toggle_popup.py becomes the proxy when the backing pane is ready. The proxy
runs the viewer, `herdr terminal attach <id>` for the popup session (see
herdr_api.popup_session_command()), in its own pseudo-terminal. Each attach
adds --takeover, so the popup moves from another viewer of the same
terminal. It sends every input byte to the viewer, except the popup's toggle
keys, Herdr's [keys] edit_scrollback keys, and the prefix commands in
keys.PREFIX_COMMANDS. The toggle keys hide the popup and the program keeps
running. help_rows() lists every key on the help page.
"""

import collections
import contextlib
import enum
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import termios
import time
import tty
import typing

import herdr_api
import popups
from herdr_api import HerdrError
from keys import (
    CTRL,
    MODIFIER_KEY,
    PREFIX,
    PREFIX_COMMANDS,
    PRESS,
    SHIFT,
    US_SHIFTED,
    Action,
    Combo,
    KeyFilter,
    Tokenizer,
    parse_combo,
    split_prefix,
)
from popups import SCOPES

# Wait this long for the rest of an unfinished escape sequence.
ESCAPE_SECONDS = 0.02
VIEWER_STOP_SECONDS = 2.0
SCROLLBACK_LINES = 100000
# Herdr closes a popup with SIGHUP to each process of the popup, then SIGTERM
# and SIGKILL, 250 ms apart (src/pane.rs:1760-1790 in Herdr 0.9.5).
HANG_UP_SIGNALS = (signal.SIGHUP, signal.SIGTERM)
# After Herdr closed the popup, the editor can end by itself for this long.
# Herdr gives it the same signals.
EDITOR_STOP_SECONDS = 0.2


class ActionInfo(typing.NamedTuple):
    event: str  # The trace event when the action ends a viewer.
    help: str  # The text of the action on the help page.


ACTIONS = {
    Action.HIDE: ActionInfo("toggle-key", "hide this popup"),
    Action.KILL: ActionInfo("kill", "kill this popup"),
    Action.PICKER: ActionInfo("picker", "switch to another popup"),
    Action.HELP: ActionInfo("help", "show this help"),
    Action.SCROLLBACK: ActionInfo("scrollback", "edit the scrollback in $EDITOR"),
}
# The trace events of a viewer that ended by itself.
VIEWER_ENDED_EVENT = "viewer-ended"
TAKEN_OVER_EVENT = "taken-over"
TRACE_EVENTS = frozenset(info.event for info in ACTIONS.values()) | {
    VIEWER_ENDED_EVENT, TAKEN_OVER_EVENT, "open", "switch", "popup-gone", "error"}
# The viewer, `herdr terminal attach`, closes on ctrl+b q. A Herdr prefix of
# ctrl+b takes that chord first: then prefix q kills the popup.
VIEWER_CLOSE_PREFIX = Combo("b", CTRL)


# The errors of a terminal that is gone: Herdr closed the popup, or the viewer ended.
CLOSED_ERRNOS = frozenset({errno.EIO, errno.EPIPE, errno.ENXIO, errno.EBADF})


def closed_terminal(error):
    """True when an OSError or a termios.error says that the terminal is gone."""
    if isinstance(error, OSError):
        code = error.errno
    else:
        code = error.args[0] if error.args else None
    return code in CLOSED_ERRNOS


def window_size(fd):
    """The window size of a terminal, packed for TIOCSWINSZ.

    A new popup can start before Herdr sets its size, and the viewer refuses
    a zero-sized grid. Then use 80x24: SIGWINCH brings the real size later.
    """
    default = struct.pack("HHHH", 24, 80, 0, 0)
    try:
        size = fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8)
    except OSError:
        return default
    rows, cols, _, _ = struct.unpack("HHHH", size)
    return size if rows and cols else default


def run_editor(path):
    """Open `path` in $EDITOR at the last line, as `+` does in vi, vim, and nvim.

    Do not kill the editor on an exception, as subprocess.run does. When Herdr
    closes the popup, the editor gets its own SIGHUP. Let it end by itself, so
    that it can keep its recovery state. Herdr then ends each process that
    stays in the popup's session.
    """
    # Only the scrollback editor needs subprocess and tempfile. A popup must
    # show fast, so the proxy imports them here.
    import subprocess

    editor = subprocess.Popen(["/bin/sh", "-c", 'eval "${EDITOR:-vi} + \\"\\$1\\""', "sh", path])
    try:
        editor.wait()
    except BaseException:
        with contextlib.suppress(subprocess.TimeoutExpired):
            editor.wait(EDITOR_STOP_SECONDS)
        raise


def write_all(fd, data):
    view = memoryview(data)
    while view:
        try:
            written = os.write(fd, view)
        except InterruptedError:
            continue
        except BlockingIOError:
            select.select([], [fd], [], 1)
            continue
        view = view[written:]


class AttachNudge:
    """Wake the popup server once a new viewer has connected, so that it takes the viewer soon.

    `terminal attach` connects to the server's client socket at once
    (src/client/mod.rs:245 in Herdr 0.9.5), and then writes its terminal
    setup: its first output. But an idle server takes a new client only on a
    loop pass, and its idle loop sleeps up to 250 ms
    (CLIENT_ACCEPT_POLL_INTERVAL, src/server/headless.rs:161-167, :495). A
    request that the loop handles wakes it (api_rx, :626); `ping` does not,
    because the API thread answers it itself (src/api/server.rs:559).

    So on the first output, send() sends one such request and does not wait
    for its answer. If no frame comes, send() runs again AGAIN seconds after
    the first output. Output more than FRAME_GAP after the first output is
    the frame: the terminal setup comes in one burst. `shown` is then True.
    The frame can also come in the same burst as the setup. So `shown` also
    becomes True SHOWN_BY seconds after the first output.
    """

    AGAIN = (0.025, 0.05)
    FRAME_GAP = 0.005
    SHOWN_BY = 0.1

    def __init__(self, send):
        self.send = send
        self.first = None
        self.again = []
        self.shown = False

    def output(self, now):
        """The viewer wrote output at `now`."""
        if self.first is None:
            self.first = now
            self.again = [now + delay for delay in self.AGAIN]
            self.send()
        elif now - self.first >= self.FRAME_GAP:
            self.again = []
            self.shown = True

    def timeout(self, now):
        """Seconds until tick() has work, or None."""
        times = self.again[:1]
        if self.first is not None and not self.shown:
            times.append(self.first + self.SHOWN_BY)
        return max(min(times) - now, 0.0) if times else None

    def tick(self, now):
        if self.again and now >= self.again[0]:
            self.again.pop(0)
            self.send()
        if self.first is not None and now - self.first >= self.SHOWN_BY:
            self.shown = True


# A small request that the popup server's main loop handles (see AttachNudge).
NUDGE_METHOD = "workspace.list"
# A nudge is only a speed-up: a slow server must not hold the relay loop.
NUDGE_TIMEOUT = 0.05


class Viewer:
    """One `terminal attach` process in its own pseudo-terminal.

    The viewer attaches with --takeover: it takes the terminal from another
    viewer, which then ends with ATTACH_TAKEN_OVER. The viewer's stderr goes
    to a pipe, because Herdr writes there why the attach ended. The viewer
    gets the window size of `size_fd`, the popup terminal. Its first output
    starts an AttachNudge of the popup server.
    """

    ERRORS_KEPT = 4096

    def __init__(self, terminal_id, size_fd=0):
        argv, env = herdr_api.popup_session_command("terminal", "attach", terminal_id,
                                                    "--takeover")
        self.terminal_id = terminal_id
        self.size_fd = size_fd
        self.status = None
        self.errors = b""
        # The attach client reads its grid size at once and refuses 0x0. So
        # the child sets the size before it runs the client: on a busy machine
        # the client can start before the proxy runs again.
        size = window_size(size_fd)
        errors_read, errors_write = os.pipe()
        try:
            self.pid, self.fd = pty.fork()
        except BaseException:
            os.close(errors_read)
            os.close(errors_write)
            raise
        if self.pid == 0:
            try:
                with contextlib.suppress(OSError):
                    fcntl.ioctl(0, termios.TIOCSWINSZ, size)
                os.dup2(errors_write, 2)
                os.execvpe(argv[0], argv, env)
            except OSError as error:
                os.write(2, f"cannot run {argv[0]}: {error}\n".encode())
            finally:
                os._exit(127)
        os.close(errors_write)
        os.set_blocking(errors_read, False)
        self.errors_fd = errors_read
        server = herdr_api.popup_herdr(timeout=NUDGE_TIMEOUT)
        self.nudge = AttachNudge(lambda: server.nudge(NUDGE_METHOD))

    def resize(self):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, window_size(self.size_fd))

    def read(self):
        """Return output bytes, or b"" when the viewer has ended."""
        try:
            data = os.read(self.fd, 65536)
        except OSError as error:
            if not closed_terminal(error):
                raise
            data = b""
        if data:
            self.nudge.output(time.monotonic())
        return data

    def read_errors(self):
        """Keep the end of the viewer's stderr. Close the pipe at its end."""
        while self.errors_fd is not None:
            try:
                data = os.read(self.errors_fd, 4096)
            except BlockingIOError:
                return
            except OSError:
                data = b""
            if not data:
                os.close(self.errors_fd)
                self.errors_fd = None
                return
            self.errors = (self.errors + data)[-self.ERRORS_KEPT:]

    def _reap(self, block=False):
        """Return True when the viewer process has ended. Keep its exit status."""
        if self.pid is None:
            return True
        try:
            pid, status = os.waitpid(self.pid, 0 if block else os.WNOHANG)
        except ChildProcessError:
            self.pid = None
            return True
        if not pid:
            return False
        self.status = os.waitstatus_to_exitcode(status)
        self.pid = None
        return True

    def finish(self):
        """Wait for a viewer that ends by itself. Return its exit status and stderr text."""
        deadline = time.monotonic() + VIEWER_STOP_SECONDS
        while not self._reap() and time.monotonic() < deadline:
            fds = [self.errors_fd] if self.errors_fd is not None else []
            select.select(fds, [], [], 0.02)
            self.read_errors()
        if self.pid is not None:
            self.stop()
        else:
            self.close()
        return self.status, self.errors.decode("utf-8", errors="replace")

    def stop(self, drain_to=None):
        """End the viewer with SIGTERM, so it restores the terminal modes it set.

        `drain_to(data)` gets the viewer's last output, such as that restore.
        """
        if self.pid is not None:
            with contextlib.suppress(ProcessLookupError):
                os.kill(self.pid, signal.SIGTERM)
        deadline = time.monotonic() + VIEWER_STOP_SECONDS
        while self.fd is not None and time.monotonic() < deadline:
            ready, _, _ = select.select([self.fd], [], [], 0.05)
            if ready:
                data = self.read()
                if not data:
                    break
                if drain_to is not None:
                    drain_to(data)
            elif self._reap():
                break
        self.close()

    def close(self):
        if self.pid is not None and not self._reap():
            with contextlib.suppress(ProcessLookupError):
                os.kill(self.pid, signal.SIGKILL)
            self._reap(block=True)
        self.read_errors()
        if self.errors_fd is not None:
            os.close(self.errors_fd)
            self.errors_fd = None
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


# Why a viewer ended. The Herdr client writes "herdr: server shut down:
# <reason>" to stderr and exits 1; only "detached" exits 0
# (src/client/mod.rs:379-393, src/client/errors.rs:36-58 in Herdr 0.9.5).
# Herdr does not show which client holds an attach, so these texts are the
# only signal. test/e2e checks them against the real Herdr.
ATTACH_TAKEN_OVER = "terminal attach taken over"  # src/server/headless.rs:1804
ATTACH_BUSY = "has a read in progress; retry"  # src/server/headless.rs:1779
TERMINAL_EXITED = "terminal {terminal_id} exited"  # src/server/headless/notifications.rs:643
ATTACH_RETRIES = 3
ATTACH_RETRY_SECONDS = 0.2


class ViewerEnd(enum.Enum):
    """Why a viewer ended by itself. The value is the trace event, if any."""

    CLOSED = VIEWER_ENDED_EVENT  # It detached, or the program exited: the popup closes.
    TAKEN_OVER = TAKEN_OVER_EVENT  # Another viewer shows the popup now: it closes here.
    BUSY = None  # Herdr was busy: attach again soon.


def viewer_end(status, errors, terminal_id, popup_gone, can_retry=False):
    """Why a viewer ended by itself: a ViewerEnd.

    `errors` is the viewer's stderr. `popup_gone()` tells if the popup pane
    is gone. BUSY comes only with `can_retry`. Raise HerdrError when the attach failed: the
    popup cannot show.
    """
    if status == 0:
        # The viewer detached: its own close key, ctrl+b q.
        return ViewerEnd.CLOSED
    if ATTACH_TAKEN_OVER in errors:
        # The program keeps running.
        return ViewerEnd.TAKEN_OVER
    if TERMINAL_EXITED.format(terminal_id=terminal_id) in errors or popup_gone():
        return ViewerEnd.CLOSED
    if can_retry and ATTACH_BUSY in errors:
        return ViewerEnd.BUSY
    lines = [line.strip() for line in errors.splitlines() if line.strip()]
    text = lines[-1] if lines else f"the viewer stopped with exit status {status}"
    text = text.removeprefix("herdr: ")
    raise HerdrError(f"cannot show the popup: {text}")


class Input:
    """The key input of the popup, as tokens.

    The viewer relay and the help and picker pages read the same tokens and
    share one set of held keys, so that no input is lost between them.
    """

    def __init__(self, fd=0, wake_fd=None):
        self.fd = fd
        # A byte on wake_fd means: the window size changed (SIGWINCH).
        self.wake_fd = wake_fd
        self.tokenizer = Tokenizer()
        self.tokens = collections.deque()
        # Keys (Key.hold) whose press the program did not get. See KeyFilter.
        self.held = set()
        # When an unfinished escape sequence becomes a key of its own.
        self.deadline = None
        # True when the popup terminal is gone: the end of input, or a failed
        # write. Herdr closed the popup, so nothing more shows.
        self.ended = False

    def timeout(self):
        """Seconds to wait for input before expire() has work, or None for no limit."""
        if self.deadline is None:
            return None
        return max(self.deadline - time.monotonic(), 0.0)

    def read(self):
        """Read the bytes that wait on the input. Return False at the end of input.

        Only a terminal that is gone ends the input. Another error is raised.
        """
        try:
            data = os.read(self.fd, 65536)
        except OSError as error:
            if not closed_terminal(error):
                raise
            data = b""
        if not data:
            self.ended = True
            self.deadline = None
            self.tokens.extend(self.tokenizer.flush())
            return False
        # A sequence that waited past its deadline ends before the new bytes:
        # a lone Esc and a later y are two keys, not alt+y.
        self.expire()
        before = self.tokenizer.pending
        self.tokens.extend(self.tokenizer.feed(data))
        pending = self.tokenizer.pending
        if not pending or self.tokenizer.in_paste:
            self.deadline = None
        elif not before or pending != before + data:
            # A new unfinished sequence. A longer one keeps its first deadline.
            self.deadline = time.monotonic() + ESCAPE_SECONDS
        return True

    def expire(self):
        """After the deadline, give up on an unfinished sequence: it becomes its own token.

        A lone Esc is then the esc key. Call this on each pass, also while
        other input or output is ready, so that it can never wait for the next key.
        """
        if self.deadline is not None and time.monotonic() >= self.deadline:
            self.deadline = None
            self.tokens.extend(self.tokenizer.flush())

    def wait(self, on_wake, fds=(), timeout=None):
        """Wait for the input, a wake-up, one of `fds`, the input deadline, or `timeout`.

        A byte on the wake pipe calls on_wake(). Read the input that waits.
        Return the ready fds, for the caller's own `fds`.
        """
        wake = [self.wake_fd] if self.wake_fd is not None else []
        limits = [limit for limit in (self.timeout(), timeout) if limit is not None]
        ready, _, _ = select.select([self.fd, *fds, *wake], [], [], min(limits, default=None))
        if self.wake_fd is not None and self.wake_fd in ready:
            os.read(self.wake_fd, 64)
            on_wake()
        if self.fd in ready:
            self.read()
        return ready

    def discard(self):
        """Drop all input that waits, as TCSAFLUSH drops the unread input."""
        self.tokens.clear()
        self.tokenizer = Tokenizer()
        self.deadline = None


class Screen:
    """The popup terminal: output, and the proxy's own pages (help and picker)."""

    RESET_KEYS = b"\x1b[=0;1u\x1b[>4;0m"

    def __init__(self, input_, stdout=1):
        self.input = input_
        self.stdout = stdout
        # The page that shows: render(rows, cols) gives its text.
        self.render = None

    def show(self, data):
        """Write to the popup terminal. After Herdr closed it, write nothing."""
        if self.input.ended:
            return
        try:
            write_all(self.stdout, data)
        except OSError as error:
            if not closed_terminal(error):
                raise
            self.input.ended = True

    def size(self):
        """The size of the popup terminal: the terminal of the input."""
        rows, cols, _, _ = struct.unpack("HHHH", window_size(self.input.fd))
        return rows, cols

    def draw(self, render):
        """Draw a page: `render(rows, cols)` gives the text of each cell.

        The first page switches to the alternate screen. The page fills each
        cell, so a later draw needs no clear and does not flicker.
        """
        entering = self.render is None
        self.render = render
        rows, cols = self.size()
        out = [self.RESET_KEYS, b"\x1b[?1049h" if entering else b"",
               render(rows, cols).encode()]
        self.show(b"".join(out))

    def read_key(self, key_filter):
        """Wait for one key on a page. Return a popup Action, a pressed Key, or None.

        `key_filter` is a page filter (to_program=False). Popup keys give their
        Action, as in the program. Another press gives its Combo. None means
        the end of input. Tokens after the key stay for the next reader. A
        resize draws the page again in the new size.
        """
        input_ = self.input
        while not input_.ended:
            input_.expire()
            while input_.tokens:
                token = input_.tokens.popleft()
                data, action = key_filter.take(collections.deque([token]))
                if action is not None:
                    return action
                key = token.key
                if data and key is not None and key.kind == PRESS and key.name != MODIFIER_KEY:
                    return key
            input_.wait(lambda: self.draw(self.render))
        return None

    def leave(self):
        self.render = None
        self.show(b"\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l")


def trace_event(popup_id, event):
    """Append `popup_id<TAB>event` to $TOGGLE_POPUP_TRACE when it is set.

    Only the fixed event names in TRACE_EVENTS are allowed. Typed input can
    hold passwords, so no input bytes or text ever go in the trace.
    """
    if event not in TRACE_EVENTS:
        raise ValueError(f"not a trace event: {event!r}")
    path = os.environ.get("TOGGLE_POPUP_TRACE")
    if path:
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(f"{popup_id}\t{event}\n")


def prefix_keys(prefix):
    """Herdr's prefix keys, without empty entries."""
    return [text.strip() for text in prefix if text.strip()]


def help_rows(prefix, toggle_keys, scrollback):
    """The (section, key chips, text) rows of the help page.

    A key is one chip. A prefix chord is two: the first prefix key, then the key.
    """
    lead = (prefix_keys(prefix) or [PREFIX])[0]

    def chips(text):
        needs_prefix, key = split_prefix(text)
        return [lead, key] if needs_prefix else [key]

    rows = [("Popup", chips(key), ACTIONS[Action.HIDE].help) for key in toggle_keys]
    rows += [("Popup", [lead, combo.label], ACTIONS[action].help)
             for combo, action in PREFIX_COMMANDS]
    if all(parse_combo(text) != VIEWER_CLOSE_PREFIX for text in prefix_keys(prefix)):
        rows.append(("Popup", [VIEWER_CLOSE_PREFIX.label, "q"],
                     "hide this popup (Herdr's viewer detach)"))
    rows += [("Program", chips(key), ACTIONS[Action.SCROLLBACK].help)
             for key in scrollback if key.strip()]
    rows.append(("Program", [lead, lead], "send the prefix key to the program"))
    return rows


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


def picker_groups(records, socket, session_name, workspaces):
    """The picker's popups: [(group label, [popup ids])].

    `records` maps each live popup id to its record. Only the popups of the
    session at `socket` show. The first group, under `session_name`,
    holds the pwd and session popups. Then come the workspace groups, with
    the workspace and tab popups, in the order of `workspaces`: the
    session's [(workspace id, label)], as Herdr's goto list shows them. A
    popup whose workspace is not in it goes in a group under its workspace
    id, at the end: the session did not answer (`workspaces` is None), or
    the workspace closed a moment ago. Each group is in label order.
    """
    mine = {popup_id: record for popup_id, record in records.items()
            if record.owner.socket == socket}

    def ordered(ids):
        return sorted(ids, key=lambda popup_id: (mine[popup_id].label, popup_id))

    shared = []
    by_workspace = {}
    for popup_id, record in mine.items():
        if SCOPES[record.scope].session_group:
            shared.append(popup_id)
        else:
            by_workspace.setdefault(record.owner.workspace_id, []).append(popup_id)
    groups = [(session_name, ordered(shared))] if shared else []
    for workspace_id, label in workspaces or []:
        if workspace_id in by_workspace:
            groups.append((label, ordered(by_workspace.pop(workspace_id))))
    groups += [(workspace_id, ordered(ids)) for workspace_id, ids in sorted(by_workspace.items())]
    return groups


def picker_place(owner, tabs):
    """Where a popup is shared, for its picker row: the tab or the folder of its owner.

    `tabs` maps the tab ids of the session to their labels. A workspace or
    session popup has no place: its group tells it.
    """
    if owner.tab_id is not None:
        return f"tab {tabs.get(owner.tab_id) or owner.tab_id}"
    if owner.folder is not None:
        home = os.path.expanduser("~").rstrip("/")
        folder = owner.folder
        if folder == home or folder.startswith(home + "/"):
            folder = "~" + folder[len(home):]
        return folder
    return ""


def typed_char(key):
    """The character that a key press types, or None."""
    name = key.name
    if key.mods == 0:
        char = name if len(name) == 1 else None
    elif key.mods == SHIFT:
        char = key.shifted or US_SHIFTED.get(name) or (name.upper() if len(name) == 1 else None)
    else:
        char = None
    return char if char is not None and char.isprintable() else None


def edit_filter(query, cursor, key):
    """The picker filter and its cursor after a key, as navigation's input edits.

    Left/right, home/end and ctrl+a/ctrl+e move. Backspace and ctrl+w delete
    before the cursor, delete after it, and ctrl+u clears. Text goes in at
    the cursor.
    """
    combo = key.combo
    if combo in (Combo("left", 0), Combo("right", 0)):
        step = -1 if combo.name == "left" else 1
        return query, min(len(query), max(0, cursor + step))
    if combo in (Combo("home", 0), Combo("a", CTRL)):
        return query, 0
    if combo in (Combo("end", 0), Combo("e", CTRL)):
        return query, len(query)
    if combo in (Combo("backspace", 0), Combo("h", CTRL)):
        start = max(0, cursor - 1)
        return query[:start] + query[cursor:], start
    if combo == Combo("delete", 0):
        return query[:cursor] + query[cursor + 1:], cursor
    if combo == Combo("w", CTRL):
        # Delete the word before the cursor, as a shell does.
        start = len(query[:cursor].rstrip().rpartition(" ")[0])
        return query[:start] + query[cursor:], start
    if combo == Combo("u", CTRL):
        return "", 0
    char = typed_char(key)
    if char is None:
        return query, cursor
    return query[:cursor] + char + query[cursor:], cursor + 1


class Next(enum.Enum):
    """What the proxy does after a popup command."""

    CLOSE = "close"  # The popup closes.
    SHOW = "show"  # Show the program again.


class Proxy:
    def __init__(self, popup_id, prefix, scrollback, main_herdr, popup_herdr, stdin=0, stdout=1,
                 default_shell=None, on_shown=None):
        """`main_herdr` is the Herdr session that shows the popup. `default_shell`
        is the main config's default_shell: the picker names it as the label does.
        `on_shown()` runs once, after the popup first shows the frame of its
        program (see AttachNudge)."""
        self.popup_id = popup_id
        self.on_shown = on_shown
        self.default_shell = default_shell
        self.stdin = stdin
        self.prefix = prefix
        self.scrollback = scrollback
        self.main = main_herdr
        self.popup_herdr = popup_herdr
        self.wake_read, self.wake_write = os.pipe()
        os.set_blocking(self.wake_write, False)
        self.input = Input(stdin, self.wake_read)
        self.screen = Screen(self.input, stdout)
        self.viewer = None
        # The record of the popup that shows: relay() sets it from the popup session.
        self.record = None
        self.cooked = None
        self.hung_up = False

    def wake(self, *_):
        """SIGWINCH: wake the relay loop. A full pipe already holds a wake-up."""
        with contextlib.suppress(BlockingIOError):
            os.write(self.wake_write, b"w")

    def end_on_hang_up(self):
        """End quietly on SIGHUP or SIGTERM: Herdr closed the popup.

        SystemExit runs the finally blocks: they stop the viewer and remove
        the scrollback file. A Python signal handler does not pass to a child
        program, so the editor still gets its own SIGHUP.
        """
        for signum in HANG_UP_SIGNALS:
            signal.signal(signum, self.hang_up)

    def hang_up(self, signum, _frame):
        # Herdr sends SIGTERM after SIGHUP: do not stop the cleanup a second time.
        if self.hung_up:
            return
        self.hung_up = True
        # The popup terminal is gone: write nothing more, and show no toast.
        self.input.ended = True
        raise SystemExit(128 + signum)

    def run(self):
        signal.signal(signal.SIGWINCH, self.wake)
        self.end_on_hang_up()
        self.cooked = termios.tcgetattr(self.stdin)
        tty.setraw(self.stdin)
        try:
            self.relay()
        finally:
            if self.viewer is not None:
                self.viewer.stop()
                self.viewer = None
            # A terminal that Herdr closed has no modes to restore.
            if not self.input.ended:
                self.set_modes(self.cooked)
            self.close_wake_pipe()

    def close_wake_pipe(self):
        # No SIGWINCH may write to the pipe after it closes.
        signal.signal(signal.SIGWINCH, signal.SIG_DFL)
        os.close(self.wake_read)
        os.close(self.wake_write)

    def set_modes(self, modes):
        """Set the popup terminal modes. Return False when Herdr closed the terminal."""
        try:
            termios.tcsetattr(self.stdin, termios.TCSAFLUSH, modes)
        except termios.error as error:
            if not closed_terminal(error):
                raise
            self.input.ended = True
            return False
        return True

    def relay(self):
        """Show the popup's program until the popup closes.

        Each attach takes the popup from another viewer.
        """
        trace_event(self.popup_id, "open")
        retries = 0
        while True:
            popup = self.popups_live().get(self.popup_id)
            if popup is None:
                trace_event(self.popup_id, "popup-gone")
                return
            self.record = popup.record
            terminal_id = popup.pane["terminal_id"]
            key_filter = self.key_filter()
            self.viewer = Viewer(terminal_id, self.stdin)
            action = self.view(key_filter)
            if self.input.ended:
                # Herdr closed the popup: stop the viewer, and write nothing more.
                self.viewer.stop()
                self.viewer = None
                trace_event(self.popup_id, VIEWER_ENDED_EVENT)
                return
            if action is None:
                status, errors = self.viewer.finish()
                self.viewer = None
                end = viewer_end(status, errors, terminal_id,
                                 lambda: self.popup_id not in self.popups_live(),
                                 can_retry=retries < ATTACH_RETRIES)
                if end is ViewerEnd.BUSY:
                    retries += 1
                    time.sleep(ATTACH_RETRY_SECONDS)
                    continue
                trace_event(self.popup_id, end.value)
                return
            retries = 0
            # The popup closes at once on a toggle key: do not wait to restore its screen.
            self.viewer.stop(drain_to=None if action is Action.HIDE else self.screen.show)
            self.viewer = None
            trace_event(self.popup_id, ACTIONS[action].event)
            if self.act(action, popup) is Next.CLOSE:
                return

    def popups_live(self):
        return popups.live_popups(self.popup_herdr.snapshot())

    def key_filter(self, to_program=True):
        """The key filter of the current popup. Pages use to_program=False."""
        return KeyFilter(self.prefix, self.record.toggle_keys, self.scrollback,
                         held=self.input.held, to_program=to_program)

    def view(self, key_filter):
        """Relay until the viewer ends (None) or a popup key arrives (its Action).

        Input after the popup key stays in self.input for the next reader.
        """
        viewer, input_ = self.viewer, self.input
        while not input_.ended:
            input_.expire()
            data, action = key_filter.take(input_.tokens)
            if data:
                try:
                    write_all(viewer.fd, data)
                except OSError as error:
                    if not closed_terminal(error):
                        raise
                    # The viewer ended, as when the program exited: relay() asks why.
                    return None
            if action is not None:
                return action
            fds = [viewer.fd] + ([viewer.errors_fd] if viewer.errors_fd is not None else [])
            ready = input_.wait(viewer.resize, fds, viewer.nudge.timeout(time.monotonic()))
            viewer.nudge.tick(time.monotonic())
            if viewer.errors_fd is not None and viewer.errors_fd in ready:
                viewer.read_errors()
            if viewer.fd in ready:
                data = viewer.read()
                if not data:
                    return None
                self.screen.show(data)
            if viewer.nudge.shown and self.on_shown is not None:
                on_shown, self.on_shown = self.on_shown, None
                on_shown()
        return None

    def act(self, action, popup):
        """Run popup commands, from `action` on: a page can give the next one.

        `popup` is the LivePopup that shows. Return what comes next: a Next.
        """
        while action is not None and not self.input.ended:
            if action is Action.HIDE:
                self.main.call("popup.close")
                return Next.CLOSE
            if action is Action.KILL:
                with popups.popup_lock():
                    popups.close_popup(self.popup_herdr, popup.workspace_id, self.popup_id)
                return Next.CLOSE
            if action is Action.HELP:
                action = self.help()
            elif action is Action.PICKER:
                action, switched = self.pick()
                if switched:
                    return Next.SHOW
            elif action is Action.SCROLLBACK:
                action = None
                try:
                    self.edit_scrollback(popup.pane)
                except (HerdrError, OSError) as error:
                    # Show the error and go back to the program in the popup.
                    herdr_api.report_error("scrollback", error, self.main.endpoint)
            if action is not None:
                trace_event(self.popup_id, ACTIONS[action].event)
        return Next.CLOSE if self.input.ended else Next.SHOW

    def help(self):
        """Show the keys. Return the popup Action of a popup key, or None to go back.

        Every key closes help. A toggle key, prefix q, g, or e then runs its
        action. Prefix ? and any other key only close help: the program does
        not get them.
        """
        import pages

        tokens = pages.theme()
        title = pages.visible(f"{self.record.label} popup")
        origin = f"{self.popup_id} · prefix {' / '.join(prefix_keys(self.prefix)) or PREFIX}"
        rows = [(section, [pages.visible(key) for key in chips], text)
                for section, chips, text in help_rows(self.prefix, self.record.toggle_keys,
                                                      self.scrollback)]
        self.screen.draw(lambda height, width: pages.help_page(
            height, width, title, origin, rows).render(tokens))
        key = self.screen.read_key(self.key_filter(to_program=False))
        self.screen.leave()
        return key if isinstance(key, Action) and key is not Action.HELP else None

    def session_view(self):
        """The main session's [(workspace id, label)] and {tab id: label}.

        The workspaces are None when the session does not answer.
        """
        try:
            snapshot = self.main.snapshot()
        except HerdrError:
            return None, {}
        workspaces = [(item["workspace_id"], item.get("label") or item["workspace_id"])
                      for item in snapshot.get("workspaces", [])]
        return workspaces, {item["tab_id"]: item.get("label") for item in snapshot.get("tabs", [])}

    def pick(self):
        """Choose a popup of this session in a list with a filter.

        Typed text filters the list (pages.fuzzy). Up/down and ctrl+n/ctrl+p
        move, and enter shows the selected popup. Backspace, ctrl+w and
        ctrl+u edit the filter. Esc clears the filter. With an empty filter,
        esc keeps this popup, as ctrl+c does. Popup keys act as in the
        program, before filter text. Return (popup Action or None, True when
        the popup changed).
        """
        import pages

        with popups.popup_lock():
            popups.housekeeping_sweep(self.popup_herdr)
            records = {popup_id: popup.record for popup_id, popup in self.popups_live().items()}
        workspaces, tabs = self.session_view()
        groups = picker_groups(records, self.main.endpoint,
                               herdr_api.session_name(self.main.endpoint), workspaces)
        rows = []
        for group, members in groups:
            shared = SCOPES[records[members[0]].scope].session_group
            for popup_id in members:
                record = records[popup_id]
                rows.append(pages.PickerRow(
                    popup_id, pages.visible(record.label),
                    pages.visible(popups.program_text(record.command, self.default_shell)),
                    pages.visible(picker_place(record.owner, tabs)), pages.visible(group),
                    "session" if shared else "workspace", popup_id == self.popup_id))
        if not rows:
            return None, False
        tokens = pages.theme()
        here = next((n for n, row in enumerate(rows) if row.current), 0)
        query, cursor, selected = "", 0, here
        key_filter = self.key_filter(to_program=False)
        while True:
            found = pages.matches(rows, query)
            selected = min(selected, max(0, len(found) - 1))
            self.screen.draw(lambda height, width, query=query, cursor=cursor, found=found,
                             selected=selected:
                             pages.picker_page(height, width, query, cursor, found, len(rows),
                                               selected, pages.picker_columns(rows, width))
                             .render(tokens))
            key = self.screen.read_key(key_filter)
            if isinstance(key, Action):
                if key is Action.PICKER:
                    continue
                self.screen.leave()
                return key, False
            if key is None:
                break
            combo = key.combo
            if combo == Combo("c", CTRL):
                break
            if combo == Combo("esc", 0):
                if not query:
                    break
                query, cursor, selected = "", 0, here
            elif combo in (Combo("down", 0), Combo("n", CTRL)):
                selected = (selected + 1) % max(1, len(found))
            elif combo in (Combo("up", 0), Combo("p", CTRL)):
                selected = (selected - 1) % max(1, len(found))
            elif combo == Combo("enter", 0):
                if not found:
                    continue
                chosen = found[selected][0].popup_id
                if chosen != self.popup_id:
                    self.popup_id = chosen
                    trace_event(self.popup_id, "switch")
                    self.screen.leave()
                    return None, True
                break
            else:
                edited, cursor = edit_filter(query, cursor, key)
                if edited != query:
                    query = edited
                    selected = 0 if query else here
        self.screen.leave()
        return None, False

    def edit_scrollback(self, pane):
        """Open the scrollback in $EDITOR. If Herdr closes the popup meanwhile, stop quietly."""
        text = read_scrollback(pane["pane_id"])
        try:
            saved = termios.tcgetattr(self.stdin)
        except termios.error as error:
            if not closed_terminal(error):
                raise
            self.input.ended = True
            return
        import tempfile

        handle, path = tempfile.mkstemp(prefix="herdr-popup-scrollback-", suffix=".txt")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(text)
            self.screen.show(Screen.RESET_KEYS)
            # TCSAFLUSH drops the input that the proxy did not read yet. Drop the
            # input that it read too, so no key typed before the editor reaches
            # the program after it.
            if not self.set_modes(self.cooked):
                return
            self.input.discard()
            run_editor(path)
        finally:
            if not self.input.ended:
                self.set_modes(saved)
            os.unlink(path)
