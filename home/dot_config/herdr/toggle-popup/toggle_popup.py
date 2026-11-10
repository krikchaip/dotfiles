#!/usr/bin/env python3
"""Show a persistent popup. Create its program first if it does not exist.

Herdr runs this in its built-in popup, from a `[[keys.command]] type =
"popup"` key, through toggle.sh. The bind sets the popup size. This one
process finds or creates the backing pane, and then becomes the key-filter
proxy of the popup (see proxy.py). When it ends, the popup closes. Every
error shows as a Herdr toast, and the popup closes.

Usage:
  toggle_popup.py [--scope tab|workspace|pwd|session] [--name LABEL]
                  [--toggle-key KEY]... [-d DIR] [-- COMMAND...]

The popup id is a hash of the scope key, the command, and the sorted toggle
keys. The same id gives the same popup. --name, -d and the popup size do not
change it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

# The version check runs first: the other modules need Python 3.11. An old
# Python runs this file again on a newer one, so it imports nothing more.
from python_guard import require_python

require_python("toggle")

import argparse
import contextlib
import hashlib
import json
import shlex
import signal
import socket
import time
from pathlib import Path

import herdr_api
import herdr_config
import images
import popups
import proxy
from herdr_api import POPUP_SESSION, Herdr, HerdrError
from keys import parse_binding
from launch import DEFAULT_SHELL_ENV, IMAGE_SOCKET_ENV, OWNER_SOCKET_ENV, START_ENV
from popups import SCOPES, Owner, PopupRecord

# A toggle key must feel instant. So the modules that only a new popup or a
# new popup server needs (shutil, subprocess, tempfile) are imported where
# they are used.
POPUP_ID_LENGTH = 6
LAUNCHER = Path(__file__).resolve().parent / "launch.py"
SERVER_START_SECONDS = 5.0
# How long a new backing pane may take to start launch.py.
PROGRAM_START_SECONDS = 5.0


class UsageError(ValueError):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def parse_args(argv):
    """Parse the toggle flags. Everything after `--` is the popup command."""
    argv = list(argv)
    command = None
    if "--" in argv:
        split = argv.index("--")
        argv, command = argv[:split], argv[split + 1:]
        if not command:
            raise UsageError("a command must follow --")
    parser = _Parser(prog="toggle_popup.py", add_help=False, allow_abbrev=False)
    parser.add_argument("--scope", choices=list(SCOPES), default="workspace")
    parser.add_argument("--name")
    parser.add_argument("--toggle-key", dest="toggle_keys", action="append", default=[])
    parser.add_argument("-d", dest="directory")
    options = parser.parse_args(argv)
    if options.name is not None and not options.name.strip():
        raise UsageError("--name must not be empty")
    for key in options.toggle_keys:
        try:
            parse_binding(key)
        except ValueError as error:
            raise UsageError(f"--toggle-key: {error}") from error
    options.command = command
    return options


def popup_owner(scope, env):
    """The owner of a popup in `scope`: the Herdr session socket, plus the
    values of the scope (see popups.SCOPES). A tab popup also records the
    workspace of its tab."""
    values = {}
    for field, name in SCOPES[scope].owner_env:
        if not env.get(name):
            raise UsageError(f"--scope {scope} needs {name}: run this from a Herdr key binding")
        values[field] = env[name]
    owner = Owner(env["HERDR_SOCKET_PATH"], **values)
    if owner.folder is not None:
        owner.folder = os.path.normpath(owner.folder)
    return owner


def popup_identity(options, env):
    """Return the popup id and the owner of the popup that the flags ask for.

    The id is the first 6 hex characters of a SHA-256 hash of the scope key,
    the command, and the sorted toggle keys. The hash input is a JSON list,
    so two different splits of the same words never give the same input.
    The pwd key is the real path of the folder: Herdr can give one folder as
    the shell reports it (/tmp/shop, a symlink) or as the real path
    (/private/tmp/shop). The record keeps the folder as Herdr gave it, for
    the picker.
    """
    owner = popup_owner(options.scope, env)
    folder = os.path.realpath(owner.folder) if owner.folder else None
    key = [options.scope, owner.socket, owner.workspace_id, owner.tab_id, folder,
           options.command, sorted(set(options.toggle_keys))]
    digest = hashlib.sha256(json.dumps(key).encode()).hexdigest()
    return digest[:POPUP_ID_LENGTH], owner


def popup_label(options, default_shell):
    """The label of a popup: --name, or else the text of its program."""
    return options.name or popups.program_text(options.command, default_shell)


def write_if_changed(path, text, mode=0o644):
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")
    path.chmod(mode)


def popup_session_config(default_shell):
    """Write the popup server's minimal config: no custom keys and no onboarding.

    Its default shell is a script that runs launch.py, which starts the
    user's default shell with the user's environment. `default_shell` is the
    main config's [terminal] default_shell, or None. The script holds it, so
    that a new shell popup uses the current value without a server restart.
    """
    folder = popups.plugin_state_dir()
    shell = folder / "popup-shell"
    name = DEFAULT_SHELL_ENV
    value = f"export {name}={shlex.quote(default_shell)}" if default_shell else f"unset {name}"
    write_if_changed(shell, "\n".join([
        "#!/bin/sh", "# Written by the toggle-popup plugin. Changes are lost.", value,
        f"exec {shlex.quote(sys.executable)} {shlex.quote(str(LAUNCHER))}", ""]), 0o755)
    path = herdr_api.popup_session_config_path()
    # Without kitty graphics, the popup panes keep image placeholder cells as
    # text, and the viewer passes them to the popup (see images.py).
    write_if_changed(path, "\n".join([
        "# Written by the toggle-popup plugin. Changes are lost.", "onboarding = false", "",
        "[terminal]", f"default_shell = {json.dumps(str(shell))}", "kitty_graphics = false",
        ""]))
    return path


def ensure_popup_server(default_shell):
    """Start the popup session server if it does not answer.

    `default_shell` is the main config's [terminal] default_shell. Each call
    writes the popup session config again when it changed: its shell script
    names this Python and the default shell. A version manager can remove an
    older Python while the server runs, and the user can change the default
    shell.

    A running server must be the plugin's own (see
    herdr_api.check_popup_server()). Only when no server owns the socket
    ("gone") does a new one start. A server that does not answer in time
    still owns the socket: the error goes to the toast.
    """
    popup_session_config(default_shell)
    herdr = herdr_api.popup_herdr()
    try:
        herdr.call("ping")
    except HerdrError as error:
        if error.code != "gone":
            raise
        return start_popup_server(herdr)
    herdr_api.check_popup_server(herdr)
    return herdr


def start_popup_server(herdr):
    """Start the popup session server, with no plugin list. Return when it answers.

    `herdr server` stays in the foreground. The toggle keeps the socket
    identity (see herdr_api.remember_popup_server()) only when this child
    process owns the socket. Another server can take the socket first, such
    as one that the user starts by hand at the same time. The child then
    ends with "already running" (src/ipc.rs:97 in Herdr 0.9.5), and the
    toggle refuses the other server.
    """
    import subprocess

    # A plugin that a `herdr plugin link` gave the last server must not load again.
    herdr_api.clear_popup_plugins()
    argv, env = herdr_api.popup_session_command("server")
    server = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              start_new_session=True, cwd=str(Path.home()))
    deadline = time.monotonic() + SERVER_START_SECONDS
    while time.monotonic() < deadline:
        if server.poll() is not None:
            if herdr.alive():
                raise herdr_api.not_own_server_error()
            break
        if herdr.alive() and herdr_api.socket_owner_pid(herdr.endpoint) == server.pid:
            herdr_api.remember_popup_server()
            return herdr
        time.sleep(0.05)
    raise HerdrError(f"the {POPUP_SESSION} Herdr session did not start")


class StartCheck:
    """Learn whether the program of a new backing pane started.

    launch.py connects to this Unix socket (its path is in `env`) before it
    runs the program. The connection closes when the program starts, with no
    data. When the program cannot start, launch.py sends the error first.
    This catches each start failure: a missing program, a file that is not a
    program, and a launcher that does not run at all.
    """

    def __enter__(self):
        import tempfile

        # A short folder: a Unix socket path must stay below 104 bytes on macOS.
        self.folder = tempfile.mkdtemp(prefix="toggle-popup-")
        path = os.path.join(self.folder, "start.sock")
        self.server = socket.socket(socket.AF_UNIX)
        try:
            self.server.bind(path)
            self.server.listen(1)
        except BaseException:
            self.__exit__()
            raise
        self.env = {START_ENV: path}
        return self

    def __exit__(self, *exc_info):
        import shutil

        self.server.close()
        shutil.rmtree(self.folder, ignore_errors=True)

    def wait(self):
        """Return when the program started. Raise HerdrError when it did not."""
        timeout = PROGRAM_START_SECONDS
        deadline = time.monotonic() + timeout
        data = b""
        try:
            self.server.settimeout(timeout)
            client, _ = self.server.accept()
            with client:
                while True:
                    client.settimeout(max(deadline - time.monotonic(), 0.01))
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    data += chunk
        except TimeoutError:
            raise HerdrError(f"the popup program did not start in {timeout:g} seconds") from None
        if data:
            raise HerdrError(data.decode(errors="replace").strip())


def create_popup(herdr, popup_id, options, owner, label, default_shell):
    """Create the popup's workspace and backing pane, and save its record.

    `default_shell` is the main config's default_shell, or None. It names the
    program in the toast of a default shell that exits at once.

    Raise HerdrError when the program cannot start (see StartCheck).
    """
    folder = {"cwd": options.directory} if options.directory else {}
    # The last image request of an old program of this popup: a new program
    # shows no image yet.
    images.request_path(popup_id).unlink(missing_ok=True)
    with StartCheck() as start:
        # launch.py points `herdr` commands in the popup at the owner session.
        # The program sends its image previews to the proxy (images.py).
        env = {**start.env, OWNER_SOCKET_ENV: owner.socket,
               IMAGE_SOCKET_ENV: str(images.socket_path(popup_id))}
        params = {"label": popup_id, "focus": False, **folder}
        if not options.command:
            # The root pane runs the default shell: popup-shell, then launch.py.
            params["env"] = env
        created = herdr.call("workspace.create", params)
        workspace_id = created["workspace"]["workspace_id"]
        try:
            pane_id = created["root_pane"]["pane_id"]
            if options.command:
                # launch.py gives the program the user's environment back.
                root = {"type": "pane", "command": [sys.executable, str(LAUNCHER),
                                                    *options.command],
                        "env": env, **folder}
                layout = herdr.call("layout.apply", {"tab_id": created["tab"]["tab_id"],
                                                     "root": root})["layout"]
                pane_id = layout["focused_pane_id"]
            # A program that cannot start ends its pane at once: wait first,
            # so that the toast tells why.
            start.wait()
            try:
                pane = herdr.call("pane.get", {"pane_id": pane_id})["pane"]
            except HerdrError as error:
                if error.code != "pane_not_found":
                    raise
                program = popups.program_text(options.command, default_shell)
                raise HerdrError(f"{program} exited at once") from None
            popups.save_record(PopupRecord(popup_id, options.scope, label, pane["terminal_id"],
                                           options.command, options.toggle_keys, owner))
        except BaseException:
            try:
                popups.close_popup(herdr, workspace_id)
            except Exception as cleanup_error:
                # Keep the first error: it tells why the popup could not start.
                print(f"toggle-popup: cannot close workspace {workspace_id} of a failed popup: "
                      f"{herdr_api.error_text(cleanup_error)}", file=sys.stderr)
            raise


def prepare_popup(herdr, popup_id, options, owner, default_shell):
    """Create the popup, or update its label.

    `default_shell` is the main config's default_shell, or None.

    The label follows the flags of each toggle, as tmux-toggle-popup binds
    again on each open. The command and folder apply only when the popup is
    created. The caller holds the popup lock.
    """
    label = popup_label(options, default_shell)
    popup = popups.live_popups(herdr.snapshot()).get(popup_id)
    if popup is None:
        create_popup(herdr, popup_id, options, owner, label, default_shell)
        return
    record = popup.record
    if record.label != label:
        record.label = label
        popups.save_record(record)


def sweep_in_background():
    """Run popups.housekeeping_sweep() in a new process, and return at once.

    The proxy calls this when the popup shows its program, so the sweep
    does not make the popup slow, and the relay loop does not wait for it.
    The sweep holds the popup lock, as each change to the popup session
    does. It never closes the popup that shows: its owner session is live.

    The sweep process starts its own session, so the signals that close the
    popup do not stop it. Its stdin, stdout and stderr are /dev/null: the
    popup closes when the proxy ends, and the popup must not show its log.
    It closes all other files, such as the viewer's pseudo-terminal: it must
    not keep them open after the proxy ends. A failed fork only skips the
    sweep: the next toggle sweeps.
    """
    try:
        pid = os.fork()
    except OSError:
        return
    if pid:
        # The first child ends at once, after its own fork.
        with contextlib.suppress(ChildProcessError):
            os.waitpid(pid, 0)
        return
    try:
        os.setsid()
        if os.fork():
            return
        for signum in (*proxy.HANG_UP_SIGNALS, signal.SIGWINCH):
            signal.signal(signum, signal.SIG_DFL)
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        close_other_files()
        with popups.popup_lock():
            popups.housekeeping_sweep(herdr_api.popup_herdr())
    finally:
        # Never run the caller's code after the fork: not its finally blocks,
        # and not its exit handlers.
        os._exit(0)


def close_other_files():
    """Close all file descriptors above 2.

    /dev/fd lists the open ones on macOS and Linux. A loop up to the limit
    can take 1048576 close() calls.
    """
    try:
        fds = [int(name) for name in os.listdir("/dev/fd")]
    except (OSError, ValueError):
        os.closerange(3, 1024)
        return
    for fd in fds:
        if fd > 2:
            # The fd of the listdir() is closed already.
            with contextlib.suppress(OSError):
                os.close(fd)


def end_on_hang_up():
    """Until the proxy runs, end on SIGHUP or SIGTERM with SystemExit: Herdr closed the popup.

    So the cleanup of a popup that is half made still runs (see create_popup()).
    """
    def hang_up(signum, _frame):
        # Herdr sends SIGTERM after SIGHUP: do not stop the cleanup a second time.
        for other in proxy.HANG_UP_SIGNALS:
            signal.signal(other, signal.SIG_IGN)
        raise SystemExit(128 + signum)

    for signum in proxy.HANG_UP_SIGNALS:
        signal.signal(signum, hang_up)


def toggle(argv, env, state):
    """Show the popup that the flags ask for, until the popup closes.

    The popup id goes in state["popup_id"] as soon as it is known, for the
    error trace.
    """
    endpoint = env.get("HERDR_SOCKET_PATH")
    if not endpoint:
        raise UsageError("run this from a Herdr key binding: HERDR_SOCKET_PATH is not set")
    options = parse_args(argv)
    popup_id, owner = popup_identity(options, env)
    state["popup_id"] = popup_id
    config = herdr_config.read_main_config()
    with popups.popup_lock():
        herdr = ensure_popup_server(config.default_shell)
        # The image socket listens before the program starts: the program's
        # first image request waits on it until the proxy runs.
        previews = images.Images(popup_id)
        try:
            prepare_popup(herdr, popup_id, options, owner, config.default_shell)
        except BaseException:
            previews.close()
            raise
    proxy.Proxy(popup_id, config.prefix, config.scrollback, Herdr(endpoint), herdr,
                default_shell=config.default_shell, on_shown=sweep_in_background,
                images=previews).run()


def main(argv=None):
    """Run one toggle. Every error becomes a toast in the session that shows the popup.

    The error does not go to stderr: that is the popup terminal, which closes
    when this process ends.
    """
    argv = sys.argv[1:] if argv is None else argv
    end_on_hang_up()
    state = {}
    try:
        toggle(argv, os.environ, state)
    except Exception as error:
        herdr_api.report_error("toggle", error)
        if "popup_id" in state:
            with contextlib.suppress(OSError):
                proxy.trace_event(state["popup_id"], "error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
