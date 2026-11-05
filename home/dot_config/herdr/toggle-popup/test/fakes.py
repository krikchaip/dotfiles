"""Fakes for the unit tests: an in-memory popup session and owner session clients."""

import socket

import herdr_api
import launch


class FakeServerProcess:
    """A `herdr server` child process that ends after `exits_after` polls (None: never)."""

    pid = 4242

    def __init__(self, exits_after):
        self.polls_left = exits_after

    def poll(self):
        if self.polls_left is None:
            return None
        if self.polls_left == 0:
            return 1
        self.polls_left -= 1
        return None


class FakePopupSession:
    """An in-memory popup session: workspaces with one pane each.

    `fail` maps a method name to the error that the call raises. A new pane
    reports to the start check as launch.py does: with `start_error` as the
    error, or not at all when `start_error` is ... `plugins` is what
    plugin.list gives: the plugin's own server loads none.
    """

    def __init__(self):
        self.workspaces = {}
        self.closed = []
        self.fail = {}
        self.count = 0
        self.start_error = None
        self.start_envs = []
        self.plugins = []
        self.endpoint = "/fake/toggle-popup/herdr.sock"
        # The error of a ping, or None when the server answers.
        self.down = None

    def alive(self):
        return self.down is None

    def launch(self, env):
        """Start a pane's program as launch.py does: connect to the start check, if any."""
        self.start_envs.append(env)
        path = env.get(launch.START_ENV)
        if not path or self.start_error is ...:
            return
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(path)
            if self.start_error:
                client.sendall(self.start_error.encode())

    def add(self, workspace_id, label, terminal_id=None):
        self.workspaces[workspace_id] = {"label": label, "pane_id": f"{workspace_id}:p1",
                                         "terminal_id": terminal_id or f"term-{workspace_id}"}

    def pane(self, workspace_id):
        item = self.workspaces[workspace_id]
        return {"pane_id": item["pane_id"], "workspace_id": workspace_id,
                "terminal_id": item["terminal_id"]}

    def snapshot(self):
        return {
            "workspaces": [{"workspace_id": w, "label": item["label"]}
                           for w, item in self.workspaces.items()],
            "panes": [self.pane(w) for w in self.workspaces],
        }

    def call(self, method, params=None):
        if method in self.fail:
            raise self.fail[method]
        if method == "workspace.close":
            self.closed.append(params["workspace_id"])
            self.workspaces.pop(params["workspace_id"], None)
            return {}
        if method == "workspace.create":
            self.count += 1
            workspace_id = f"new{self.count}"
            self.add(workspace_id, params["label"])
            self.launch(params.get("env", {}))
            return {"workspace": {"workspace_id": workspace_id},
                    "tab": {"tab_id": f"{workspace_id}:t1"},
                    "root_pane": self.pane(workspace_id)}
        if method == "layout.apply":
            workspace_id = params["tab_id"].split(":")[0]
            item = self.workspaces[workspace_id]
            item.update(pane_id=f"{workspace_id}:p2", terminal_id=f"term-{workspace_id}-run")
            self.launch(params["root"].get("env", {}))
            return {"layout": {"focused_pane_id": item["pane_id"]}}
        if method == "pane.get":
            return {"pane": self.pane(params["pane_id"].split(":")[0])}
        if method == "ping":
            if self.down is not None:
                raise self.down
            return {}
        if method == "plugin.list":
            return {"plugins": self.plugins}
        if method == "plugin.unlink":
            self.plugins = [item for item in self.plugins
                            if item["plugin_id"] != params["plugin_id"]]
            return {"plugin_id": params["plugin_id"], "removed": True}
        raise AssertionError(f"unexpected call: {method}")


class FakeOwners:
    """Stands in for `Herdr(socket, timeout)` of owner sessions in popups.py.

    `sessions` maps a live socket to its tabs and workspaces: "w2:t3" is tab
    t3 of workspace w2, and "w1" is workspace w1 with one tab, "w1:t1".
    Sockets in `slow` do not answer in time. Every other socket has no
    server. `timeouts` records the timeout of each client.
    """

    def __init__(self):
        self.sessions = {}
        self.slow = set()
        self.timeouts = []

    def snapshot_of(self, endpoint):
        tabs = [item if ":" in item else f"{item}:t1" for item in self.sessions[endpoint]]
        workspaces = list(dict.fromkeys(tab.split(":")[0] for tab in tabs))
        return {"workspaces": [{"workspace_id": w} for w in workspaces],
                "tabs": [{"tab_id": tab, "workspace_id": tab.split(":")[0]} for tab in tabs]}

    def __call__(self, endpoint, timeout=5.0):
        self.timeouts.append(timeout)
        owners = self

        class Client:
            def snapshot(self):
                if endpoint in owners.slow:
                    raise herdr_api.HerdrError("timed out", "unreachable")
                if endpoint not in owners.sessions:
                    raise herdr_api.HerdrError("no server", "gone")
                return owners.snapshot_of(endpoint)

        return Client()
