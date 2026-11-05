"""Herdr access for the toggle-popup plugin: the socket client, session paths,
the popup session command and its environment, the popup proxy's
environment, and error toasts.
"""

import json
import os
import socket
import struct
import sys
import time
from pathlib import Path

from launch import USER_ENV

# python_guard.py keeps the plugin id, the toast title and the state folder,
# because it runs on old Python too.
from python_guard import PLUGIN_ID, TITLE
from python_guard import plugin_state_path as _plugin_state_path

POPUP_SESSION = "toggle-popup"
# The values that the toggle gives the popup proxy (see proxy_env()).
PROXY_ID_ENV = "TOGGLE_POPUP_ID"
PROXY_PREFIX_ENV = "TOGGLE_POPUP_PREFIX"
PROXY_SCROLLBACK_ENV = "TOGGLE_POPUP_SCROLLBACK"
PROXY_DEFAULT_SHELL_ENV = "TOGGLE_POPUP_MAIN_DEFAULT_SHELL"
# The Python that runs the proxy: the manifest's popup command reads it.
PROXY_PYTHON_ENV = "TOGGLE_POPUP_PYTHON"
# The user's values that launch.py puts back in the backing panes.
USER_VALUES = ("XDG_CONFIG_HOME", "SHELL", "HERDR_CONFIG_PATH")
# In the plugin state folder: the socket file of the popup server that the
# toggle started (see check_popup_server()).
POPUP_SERVER_FILE = "popup-server.json"


class HerdrError(RuntimeError):
    """A Herdr API call failed. `code` is Herdr's error code, if any.

    Two codes are the plugin's own: "gone" (no server owns the socket) and
    "unreachable" (the server did not answer).
    """

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class Herdr:
    """A client for one Herdr server socket: one JSON line out, one line back."""

    def __init__(self, endpoint, timeout=5.0):
        self.endpoint = str(endpoint)
        self.timeout = timeout

    def call(self, method, params=None):
        request = {"id": f"{PLUGIN_ID}:{time.time_ns()}", "method": method,
                   "params": params if params is not None else {}}
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(self.timeout)
                client.connect(self.endpoint)
                client.sendall((json.dumps(request) + "\n").encode())
                with client.makefile("r", encoding="utf-8") as stream:
                    line = stream.readline()
        except (FileNotFoundError, ConnectionRefusedError) as error:
            # No server owns this socket: the session does not run.
            message = f"{method}: no Herdr server at {self.endpoint}: {error}"
            raise HerdrError(message, "gone") from error
        except OSError as error:
            message = f"{method}: cannot reach {self.endpoint}: {error}"
            raise HerdrError(message, "unreachable") from error
        if not line:
            raise HerdrError(f"{method}: empty response", "unreachable")
        response = json.loads(line)
        if "error" in response:
            error = response["error"]
            if isinstance(error, dict):
                raise HerdrError(f"{method}: {error.get('message', error)}", error.get("code"))
            raise HerdrError(f"{method}: {error}")
        return response["result"]

    def nudge(self, method):
        """Send a request and do not wait for its answer. Ignore each error.

        The server's answer to a closed connection is no error in Herdr
        (write_text_line_allow_disconnect, src/api/server.rs:1002 in 0.9.5).
        """
        request = {"id": f"{PLUGIN_ID}:{time.time_ns()}", "method": method, "params": {}}
        line = (json.dumps(request) + "\n").encode()
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(self.timeout)
                client.connect(self.endpoint)
                client.sendall(line)
        except OSError:
            pass

    def alive(self):
        try:
            self.call("ping")
            return True
        except HerdrError:
            return False

    def snapshot(self):
        return self.call("session.snapshot")["snapshot"]

    def notify(self, title, body):
        self.call("notification.show", {"title": title, "body": body})


def herdr_bin():
    if os.environ.get("HERDR_BIN_PATH"):
        return os.environ["HERDR_BIN_PATH"]
    # Herdr gives plugin panes and keys HERDR_BIN_PATH. Only other callers
    # import shutil: a toggle key must start fast.
    import shutil

    return shutil.which("herdr") or "herdr"


def config_dir():
    """Herdr's config folder, which also holds named session sockets."""
    if os.environ.get("XDG_CONFIG_HOME"):
        return Path(os.environ["XDG_CONFIG_HOME"]) / "herdr"
    return Path.home() / ".config" / "herdr"


def session_socket(name):
    return config_dir() / "sessions" / name / "herdr.sock"


def plugin_state_path():
    """The plugin state folder. Shell keys do not get HERDR_PLUGIN_STATE_DIR."""
    return Path(_plugin_state_path())


def plugin_state_dir():
    """plugin_state_path(), made if it does not exist."""
    path = plugin_state_path()
    path.mkdir(parents=True, exist_ok=True)
    return path


def popup_config_home():
    """The popup server's private XDG_CONFIG_HOME. It has no plugins.json."""
    return plugin_state_path() / "popup-config"


def clear_popup_plugins():
    """Remove the plugin list and the plugin folder of the popup server's config folder.

    Only a `herdr plugin link` or `install` that reached the popup server
    writes them (src/persist/plugin_registry.rs:12, src/plugin_paths.rs:6 in
    Herdr 0.9.5). Call this only when no popup server runs: the next server
    then loads no plugins.
    """
    import shutil

    folder = popup_config_home() / "herdr"
    (folder / "plugins.json").unlink(missing_ok=True)
    shutil.rmtree(folder / "plugins", ignore_errors=True)


def popup_session_config_path():
    """The popup server's minimal config (see toggle_popup.popup_session_config())."""
    return plugin_state_path() / "popup-session.toml"


def popup_session_command(*args):
    """The argv and environment of a `herdr` command for the popup session.

    Herdr reads its plugin list from $XDG_CONFIG_HOME/herdr/plugins.json
    (src/persist/plugin_registry.rs:12 in Herdr 0.9.5), and has no switch
    that turns plugins off. So the popup server gets a private
    XDG_CONFIG_HOME without that file, and loads no plugins. HERDR_SOCKET_PATH
    keeps its socket in the user's config folder, where `herdr --session
    toggle-popup` finds it. The command has no --session flag: with it,
    Herdr ignores HERDR_SOCKET_PATH (src/session.rs:176-182) and puts the
    socket in the private folder, where its path can be too long.

    The values of the main session (HERDR_*) do not go to the popup session.
    The user's XDG_CONFIG_HOME, SHELL and HERDR_CONFIG_PATH go in
    USER_ENV, for launch.py.
    """
    socket = session_socket(POPUP_SESSION)
    user = {name: os.environ.get(name) for name in USER_VALUES}
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("HERDR_") or key == "HERDR_BIN_PATH"}
    env.update({
        "XDG_CONFIG_HOME": str(popup_config_home()),
        "HERDR_SOCKET_PATH": str(socket),
        "HERDR_CONFIG_PATH": str(popup_session_config_path()),
        USER_ENV: json.dumps(user),
    })
    return [herdr_bin(), *args], env


def proxy_env(popup_id, prefix, scrollback, default_shell):
    """The environment that the toggle gives the popup proxy: the popup id,
    the prefix and scrollback keys as JSON lists, and the main config's
    default_shell as JSON (a string or null). The picker names the default
    shell with it, as the label does.

    It also names this Python, which passed the version check: the proxy
    starts on it at once, not on `python3` (/usr/bin/python3 3.9 on macOS),
    which must find a newer Python and run again.
    """
    return {PROXY_ID_ENV: popup_id, PROXY_PREFIX_ENV: json.dumps(prefix),
            PROXY_SCROLLBACK_ENV: json.dumps(scrollback),
            PROXY_DEFAULT_SHELL_ENV: json.dumps(default_shell),
            PROXY_PYTHON_ENV: sys.executable}


def required_env(env, name):
    """A value that the popup proxy needs. Herdr gives HERDR_SOCKET_PATH."""
    value = env.get(name)
    if not value:
        raise ValueError(f"{name} is not set: open this popup with toggle_popup.py")
    return value


def _key_list_env(env, name):
    value = json.loads(required_env(env, name))
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{name} must be a JSON list of keys")
    return value


def read_proxy_env(env):
    """Read proxy_env() back. Return (popup_id, prefix, scrollback, default_shell).

    Raise ValueError when a value is missing or has the wrong type.
    """
    default_shell = json.loads(required_env(env, PROXY_DEFAULT_SHELL_ENV))
    if default_shell is not None and not isinstance(default_shell, str):
        raise ValueError(f"{PROXY_DEFAULT_SHELL_ENV} must be a JSON string or null")
    return (required_env(env, PROXY_ID_ENV), _key_list_env(env, PROXY_PREFIX_ENV),
            _key_list_env(env, PROXY_SCROLLBACK_ENV), default_shell)


def session_name(endpoint):
    """The Herdr session name of a socket path: `default` or the named session."""
    path = Path(endpoint)
    if path.parent.parent.name == "sessions":
        return path.parent.name
    return "default"


def popup_herdr(timeout=5.0):
    return Herdr(session_socket(POPUP_SESSION), timeout)


def socket_identity(path):
    """What changes when another server binds the socket at `path`: its
    device, inode and change time. None when there is no socket file.

    Herdr also knows its socket by device and inode (src/ipc.rs:282). The
    change time stops a match when a new file gets the inode of a removed one.
    """
    try:
        info = os.stat(path)
    except OSError:
        return None
    return [info.st_dev, info.st_ino, info.st_ctime_ns]


def socket_owner_pid(path):
    """The process id of the server that listens on the Unix socket at `path`.

    None when no server answers, or on a platform that does not tell it.
    """
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1.0)
            client.connect(str(path))
            if sys.platform == "darwin":
                # SOL_LOCAL and LOCAL_PEERPID of <sys/un.h>: Python has no names for them.
                return client.getsockopt(0, 2)
            if hasattr(socket, "SO_PEERCRED"):
                size = struct.calcsize("3i")
                pid, _, _ = struct.unpack(
                    "3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size))
                return pid
    except OSError:
        return None
    return None


def remember_popup_server():
    """Keep the socket identity of the popup server that the toggle started.

    The hooks read the file without the popup lock, so it changes in one step.
    """
    path = plugin_state_dir() / POPUP_SERVER_FILE
    identity = socket_identity(session_socket(POPUP_SESSION))
    temporary = path.with_name(f"{path.name}.{os.getpid()}")
    try:
        temporary.write_text(json.dumps({"socket": identity}) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def own_popup_server():
    """True when the popup server is the one that the toggle started."""
    identity = socket_identity(session_socket(POPUP_SESSION))
    try:
        saved = json.loads((plugin_state_path() / POPUP_SERVER_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return identity is not None and isinstance(saved, dict) and saved.get("socket") == identity


def not_own_server_error():
    return HerdrError(f"the {POPUP_SESSION} Herdr session was not started by toggle-popup; "
                      f"stop it with: herdr --session {POPUP_SESSION} server stop",
                      "not_own_server")


def check_popup_server(herdr):
    """Make sure that the popup session server runs no plugins. Raise
    HerdrError when it is not the plugin's own server.

    The plugin's own server loads no plugins (see popup_session_command()),
    but a `herdr plugin link` to its socket can add one. This unlinks each
    plugin again. A server that the user starts by hand, as with `herdr
    --session toggle-popup`, loads the user's plugins.json, so the user's
    plugins and this plugin's hooks run in it. Its workspaces can be the
    user's own work, and a sweep closes each workspace without a record. An
    unlink there would change the user's plugin list.
    """
    plugins = herdr.call("plugin.list")["plugins"]
    if not plugins:
        return
    if not own_popup_server():
        raise not_own_server_error()
    for plugin in plugins:
        herdr.call("plugin.unlink", {"plugin_id": plugin["plugin_id"]})
        print(f"toggle-popup: unlinked plugin {plugin['plugin_id']} from the {POPUP_SESSION} "
              "session", file=sys.stderr)


def error_text(error):
    """The toast text for an error. Unexpected errors also name their type."""
    if isinstance(error, (HerdrError, ValueError)) and str(error):
        return str(error)
    return f"{type(error).__name__}: {error}"


def log_error(context, error):
    """Write an error to stderr. Return its text."""
    text = error_text(error)
    print(f"toggle-popup: {context}: {text}", file=sys.stderr)
    return text


def report_error(context, error, endpoint=None):
    """Log an error to stderr and show it as a toast in the Herdr session.

    `endpoint` is the session socket, by default $HERDR_SOCKET_PATH. A failed
    toast is only logged: the error is already on its way out.
    """
    text = log_error(context, error)
    endpoint = endpoint or os.environ.get("HERDR_SOCKET_PATH")
    if not endpoint:
        return
    try:
        Herdr(endpoint).notify(TITLE, text)
    except HerdrError as toast_error:
        print(f"toggle-popup: toast: {toast_error}", file=sys.stderr)
