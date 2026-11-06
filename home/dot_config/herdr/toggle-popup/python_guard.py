"""The Python version check of the entry points: the plugin needs Python 3.11+.

Each entry point calls require_python() before it imports another plugin
module. Keep this file valid for old Python 3 versions, so that the check can
run there: use only the standard library, and no new syntax.

The entry points are toggle_popup.py and hooks.py. Herdr runs them with
the PATH of its server, and on macOS that PATH puts /usr/bin first, so
`python3` is /usr/bin/python3 (3.9). toggle.sh runs the Homebrew python3
when it exists, else `python3` from a login shell. The hooks and other
hosts can still start on an old Python. The check then runs the entry point again with the newest
`python3.N` (N >= 11) on PATH that works. When there is no such Python, it
stops with one error. A toggle shows the error as a toast; a hook only
writes it to stderr.

A key press must feel instant, so this file imports only os and sys on the
way to a newer Python, and the check of a candidate (a full Python start)
runs only once: python-checked.txt in the plugin state folder keeps the
Python that passed it. It is plain text: on the system Python of macOS,
`import json` alone takes about 4 ms.

The check runs again on the interpreter file itself, not on the candidate.
A candidate can be the shim of a version manager (pyenv, asdf, mise): a
script that selects a Python from the current folder. A popup key runs in
the folder of the focused pane, so the same shim can fail in the next
folder. The shim also takes time to start.
"""

import os
import sys

MINIMUM = (3, 11)
# How long a candidate Python can take to start and import tomllib.
PROBE_SECONDS = 5.0
# Set for the second run, so that a wrong Python on PATH cannot loop.
AGAIN = "TOGGLE_POPUP_PYTHON_AGAIN"
TITLE = "Toggle popup"
PLUGIN_ID = "dotfiles.toggle-popup"
CHECKED_FILE = "python-checked.txt"


def plugin_state_path():
    """The plugin state folder. Popup keys do not get HERDR_PLUGIN_STATE_DIR."""
    path = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if path:
        return path
    state = os.environ.get("XDG_STATE_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "state")
    return os.path.join(state, "herdr", "plugins", PLUGIN_ID)


def xcrun_shim(path):
    """True for a macOS /usr/bin tool, such as the python3 shim of xcrun.

    The shim finds its tool by its own name. Under another name, such as
    python3.12, it shows a dialog to install the developer tools. Apple
    puts no python3.N in /usr/bin, so the check never runs a file there.
    """
    return sys.platform == "darwin" and os.path.dirname(os.path.realpath(path)) == "/usr/bin"


def python_minor(name):
    """N for a file name `python3.N`, else None."""
    prefix = "python%d." % MINIMUM[0]
    rest = name[len(prefix):]
    if name.startswith(prefix) and rest.isdigit() and rest == str(int(rest)):
        return int(rest)
    return None


def newer_pythons():
    """Each `python3.N` on PATH with N >= 11, newest first.

    For each N, the first folder on PATH wins, as with `shutil.which`. One
    listing per folder is faster than a lookup for each N, and an old Python
    then does not import shutil.
    """
    found = {}
    prefix = "python%d." % MINIMUM[0]
    for folder in os.environ.get("PATH", os.defpath).split(os.pathsep):
        try:
            names = os.listdir(folder or os.curdir)
        except OSError:
            continue
        # The prefix test is fast: a PATH folder can hold thousands of names.
        for name in [name for name in names if name.startswith(prefix)]:
            minor = python_minor(name)
            if minor is None or minor < MINIMUM[1] or minor in found:
                continue
            path = os.path.join(folder, name)
            if os.access(path, os.X_OK) and not os.path.isdir(path):
                found[minor] = path
    for minor in sorted(found, reverse=True):
        if not xcrun_shim(found[minor]):
            yield found[minor]


# The check: tomllib came in Python 3.11. The output is the interpreter file.
PROBE = "import os, sys, tomllib; sys.stdout.write(os.path.realpath(sys.executable))"


def usable(path):
    """True for an interpreter file that the check can run."""
    return (os.path.isabs(path) and os.path.isfile(path) and os.access(path, os.X_OK)
            and not xcrun_shim(path))


def works(python):
    """The interpreter file of `python` when it starts and has tomllib, else None."""
    import subprocess

    try:
        result = subprocess.run([python, "-I", "-c", PROBE], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                universal_newlines=True, timeout=PROBE_SECONDS)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if result.returncode != 0 or not usable(result.stdout):
        return None
    return result.stdout


def identity(path):
    """What changes when `path` is another file: its device, inode, size and time.

    The check follows a symbolic link: a link that a package manager points
    to a new Python gets a new identity.
    """
    info = os.stat(path)
    return "%d %d %d %d" % (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def checked_text(python, interpreter):
    """The text of CHECKED_FILE: a candidate, its interpreter file, and their identities."""
    return "%s\n%s\n%s\n%s\n" % (python, identity(python),
                                   interpreter, identity(interpreter))


def checked(python):
    """The interpreter file of `python` when CHECKED_FILE says that it passed works().

    None when the file names another candidate, or when the candidate or its
    interpreter is another file now.
    """
    try:
        with open(os.path.join(plugin_state_path(), CHECKED_FILE)) as stream:
            text = stream.read()
        interpreter = text.split("\n")[2]
        if usable(interpreter) and text == checked_text(python, interpreter):
            return interpreter
    except (OSError, ValueError, IndexError):
        pass
    return None


def remember(python, interpreter):
    """Write CHECKED_FILE for a Python that passed works(). A failure costs only time."""
    folder = plugin_state_path()
    path = os.path.join(folder, CHECKED_FILE)
    temporary = "%s.%d" % (path, os.getpid())
    try:
        if not os.path.isdir(folder):
            os.makedirs(folder)
        with open(temporary, "w") as stream:
            stream.write(checked_text(python, interpreter))
        os.rename(temporary, path)
    except OSError:
        if os.path.exists(temporary):
            os.unlink(temporary)


def toast(text):
    """Show a toast in the session at $HERDR_SOCKET_PATH. A failure is only logged."""
    import json
    import socket

    endpoint = os.environ.get("HERDR_SOCKET_PATH")
    if not endpoint:
        return
    request = {"id": PLUGIN_ID + ":python", "method": "notification.show",
               "params": {"title": TITLE, "body": text}}
    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            client.settimeout(5.0)
            client.connect(endpoint)
            client.sendall((json.dumps(request) + "\n").encode())
            client.makefile("r").readline()
        finally:
            client.close()
    except OSError as error:
        sys.stderr.write("toggle-popup: toast: %s\n" % error)


def stop(context, text, show_toast):
    sys.stderr.write("toggle-popup: %s: %s\n" % (context, text))
    if show_toast:
        toast(text)
    sys.exit(1)


def require_python(context, show_toast=True):
    """Return on Python 3.11+. Otherwise run again on a newer Python, or stop.

    Hooks use show_toast=False: they run in the background, and a toast that
    no key press caused only confuses.
    """
    if sys.version_info >= MINIMUM:
        os.environ.pop(AGAIN, None)
        return
    # Only a script can start again. An import, such as by `python3 -m
    # unittest`, has no script in sys.argv[0].
    script = os.path.abspath(sys.argv[0]) if sys.argv and sys.argv[0] else ""
    if not os.environ.get(AGAIN) and os.path.isfile(script):
        for python in newer_pythons():
            interpreter = checked(python)
            if interpreter is None:
                interpreter = works(python)
                if interpreter is None:
                    continue
                remember(python, interpreter)
            os.environ[AGAIN] = "1"
            try:
                os.execv(interpreter, [interpreter, script] + sys.argv[1:])
            except OSError as error:
                stop(context, "cannot run %s: %s" % (interpreter, error), show_toast)
    text = "toggle-popup needs Python %d.%d+ (found %d.%d)" % (MINIMUM + sys.version_info[:2])
    stop(context, text, show_toast)
