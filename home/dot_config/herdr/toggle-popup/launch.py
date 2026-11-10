#!/usr/bin/env python3
"""Start the program of a backing pane with the user's environment.

The popup server runs with a private XDG_CONFIG_HOME, so that it loads no
plugins, and with the plugin's HERDR_CONFIG_PATH (see
herdr_api.popup_session_command()). Its panes get both values. This launcher
puts back the user's values from TOGGLE_POPUP_USER_ENV: it sets each value
that the user had, and removes each value that the user did not have. Then
the program runs in the launcher's place, with PWD set to its real folder
(see fix_pwd()).

A `herdr` command in a popup must reach the main Herdr session that owns
the popup, as in a normal pane. So the launcher sets HERDR_SOCKET_PATH to
TOGGLE_POPUP_OWNER_SOCKET, and removes the ids of the pane, tab and
workspace in the popup server. HERDR_ENV and HERDR_BIN_PATH stay, as in a
normal pane.

When TOGGLE_POPUP_START_SOCKET names a Unix socket, the launcher connects
to it first. The connection closes when the program starts. When the
program cannot start, the launcher sends the error on it, so that the
toggle can show the error as a toast.

  launch.py COMMAND...  run COMMAND
  launch.py             run the default shell, as Herdr does: the
                        TOGGLE_POPUP_DEFAULT_SHELL value (from the
                        popup-shell script), else $SHELL, else
                        /bin/sh. It is a login shell on macOS.

It uses only os, json, socket and sys, so it runs on any Python 3.
"""

import json
import os
import socket
import sys

# The names of the values that the launcher gets. The other plugin files
# import them from here: this file imports no other plugin file.
USER_ENV = "TOGGLE_POPUP_USER_ENV"
DEFAULT_SHELL_ENV = "TOGGLE_POPUP_DEFAULT_SHELL"
START_ENV = "TOGGLE_POPUP_START_SOCKET"
OWNER_SOCKET_ENV = "TOGGLE_POPUP_OWNER_SOCKET"
# The socket for the image previews of the popup (images.py). The program keeps it.
IMAGE_SOCKET_ENV = "TOGGLE_POPUP_IMAGE_SOCKET"
# The values that name objects in the popup server. Herdr gives them to each
# pane (src/pane.rs:203-213, src/integration/env.rs:8-10 in Herdr 0.9.5).
POPUP_SERVER_IDS = ("HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID")


def connect_start_check(path):
    """Connect to the toggle's start check. Return None without one.

    The socket is not inherited, so it closes when the program starts.
    """
    if not path:
        return None
    client = socket.socket(socket.AF_UNIX)
    try:
        client.connect(path)
    except OSError:
        # The toggle stopped its wait already.
        client.close()
        return None
    return client


def shell_argv0(shell, platform):
    """argv[0] of the default shell. Herdr's "auto" shell mode starts a login
    shell ("-nu") only on macOS."""
    name = os.path.basename(shell)
    return "-" + name if platform == "darwin" else name


def use_owner_session(env):
    """Point the Herdr values of `env` at the owner session, not at the popup server.

    Without an owner socket, `env` gets no HERDR_SOCKET_PATH: a `herdr`
    command then never reaches the popup server.
    """
    owner = env.pop(OWNER_SOCKET_ENV, "")
    for name in POPUP_SERVER_IDS:
        env.pop(name, None)
    if owner:
        env["HERDR_SOCKET_PATH"] = owner
    else:
        env.pop("HERDR_SOCKET_PATH", None)


def fix_pwd(env):
    """Make PWD name the folder that the program starts in, as a shell does.

    Each pane inherits the popup server's PWD: the folder of the toggle that
    started the server. Programs such as yazi trust PWD over the real folder,
    so a stale PWD starts them in that old folder. A PWD that names the real
    folder stays, so it keeps a symlink path.
    """
    try:
        cwd = os.getcwd()
    except OSError:
        # The folder is gone: no PWD is right.
        env.pop("PWD", None)
        return
    pwd = env.get("PWD", "")
    try:
        same = os.path.isabs(pwd) and os.path.samefile(pwd, cwd)
    except OSError:
        same = False
    if not same:
        env["PWD"] = cwd


def main(argv):
    user = json.loads(os.environ.pop(USER_ENV, None) or "{}")
    default_shell = os.environ.pop(DEFAULT_SHELL_ENV, "").strip()
    start_check = connect_start_check(os.environ.pop(START_ENV, ""))
    for name, value in user.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    use_owner_session(os.environ)
    fix_pwd(os.environ)
    if argv:
        program, args = argv[0], argv
    else:
        program = default_shell or os.environ.get("SHELL", "").strip() or "/bin/sh"
        args = [shell_argv0(program, sys.platform)]
    try:
        os.execvp(program, args)
    except OSError as error:
        message = f"cannot run {program}: {error.strerror}"
        print(f"toggle-popup: {message}", file=sys.stderr)
        if start_check is not None:
            try:
                start_check.sendall(message.encode())
            except OSError:
                pass
            start_check.close()
        return 127


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
