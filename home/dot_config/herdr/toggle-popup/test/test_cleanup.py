"""Popup records, cleanup when an owner tab or workspace closes, and the sweep."""

import contextlib
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import herdr_api
import hooks
import popups
from fakes import FakeOwners, FakePopupSession
from popups import Owner, PopupRecord


def patch_env(case, **values):
    """Set environment values for one test. The old environment comes back after it."""
    patcher = mock.patch.dict(os.environ, values)
    patcher.start()
    case.addCleanup(patcher.stop)


class StateCase(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = pathlib.Path(self.folder.name)
        patch_env(self, HERDR_PLUGIN_STATE_DIR=str(self.root / "state"))


class Records(StateCase):
    def test_a_record_round_trips_with_only_the_fields_that_are_read(self):
        owner = Owner("/x/herdr/sessions/work/herdr.sock", workspace_id="w1", tab_id="w1:t2")
        record = PopupRecord("a3f9c2", "tab", "floating", "term-1", ["nu"],
                             ["prefix+f", "ctrl+z"], owner)
        popups.save_record(record)
        self.assertEqual(popups.load_record("a3f9c2"), record)
        saved = json.loads(popups.record_path(record.id).read_text())
        self.assertEqual(sorted(saved), ["command", "id", "label", "owner", "scope",
                                         "terminal_id", "toggle_keys"])
        self.assertEqual(sorted(saved["owner"]), ["folder", "socket", "tab_id", "workspace_id"])

    def test_a_record_without_a_command(self):
        record = PopupRecord("b1", "session", "shell", "term-2", None, [], Owner("/x/a.sock"))
        popups.save_record(record)
        self.assertEqual(popups.load_record("b1"), record)

    def test_a_broken_record_counts_as_missing_and_is_removed(self):
        valid = {"id": "x", "scope": "workspace", "label": "x", "terminal_id": "t",
                 "command": None, "toggle_keys": [],
                 "owner": {"socket": "/x/a.sock", "workspace_id": "w1"}}
        # Each broken case differs from a valid record in one way only.
        self.assertIsNotNone(popups.PopupRecord.from_json(valid))
        without_owner = {key: value for key, value in valid.items() if key != "owner"}
        broken = {
            "not json": "{not json",
            "no owner": json.dumps(without_owner),
            "an unknown scope": json.dumps(dict(valid, scope="git")),
            # The field of the old record format.
            "an unknown field": json.dumps(dict(valid, shown=None)),
        }
        for case, text in broken.items():
            with self.subTest(case=case):
                popups.record_path("x").parent.mkdir(parents=True, exist_ok=True)
                popups.record_path("x").write_text(text)
                self.assertIsNone(popups.load_record("x"))
                self.assertFalse(popups.record_path("x").exists())
                self.assertEqual(popups.all_records(), [])

    def test_a_popup_session_label_never_names_a_file_outside_the_records(self):
        # A label of the popup session is only a key: it is hashed, not a path.
        self.assertEqual(popups.record_path("../../x").parent, popups.record_path("a").parent)


class Cleanup(StateCase):
    """Popups "tab", "ws", "pwd", "sess" of session `owner`, in workspace w1 (tab w1:t1)."""

    def setUp(self):
        super().setUp()
        self.owners = FakeOwners()
        self.owner_socket = self.session("owner", ["w1:t1", "w1:t2", "w2"])
        patcher = mock.patch.object(popups, "Herdr", self.owners)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.popups = FakePopupSession()
        self.count = 0

    def session(self, name, tabs):
        endpoint = str(self.root / f"{name}.sock")
        self.owners.sessions[endpoint] = tabs
        return endpoint

    def popup(self, popup_id, scope, workspace_id=None, tab_id=None, socket=None):
        """Add a live popup. Return the workspace id of its backing pane."""
        self.count += 1
        backing = f"b{self.count}"
        self.popups.add(backing, popup_id)
        owner = Owner(socket or self.owner_socket, workspace_id, tab_id,
                      "/home/u" if scope == "pwd" else None)
        popups.save_record(PopupRecord(popup_id, scope, popup_id, f"term-{backing}", None, [],
                                       owner))
        return backing

    def standard_popups(self):
        return {"tab": self.popup("tab", "tab", "w1", "w1:t1"),
                "tab2": self.popup("tab2", "tab", "w1", "w1:t2"),
                "ws": self.popup("ws", "workspace", "w1"),
                "ws2": self.popup("ws2", "workspace", "w2"),
                "pwd": self.popup("pwd", "pwd"),
                "sess": self.popup("sess", "session")}

    def live(self):
        return sorted(popups.live_popups(self.popups.snapshot()))

    def test_a_closed_tab_closes_only_its_tab_popups(self):
        self.standard_popups()
        self.owners.sessions[self.owner_socket].remove("w1:t1")
        hooks.tab_closed(self.popups, self.owner_socket, "w1:t1")
        self.assertEqual(self.live(), ["pwd", "sess", "tab2", "ws", "ws2"])
        self.assertIsNone(popups.load_record("tab"))

    def test_a_closed_tab_closes_its_popups_before_the_sweep_sees_it(self):
        # The owner session can still list the tab while the hook runs.
        self.standard_popups()
        hooks.tab_closed(self.popups, self.owner_socket, "w1:t1")
        self.assertNotIn("tab", self.live())

    def test_a_closed_workspace_closes_its_workspace_and_tab_popups(self):
        # Herdr's workspace.close sends no tab.closed for the tabs of the workspace.
        self.standard_popups()
        self.owners.sessions[self.owner_socket] = ["w2"]
        hooks.workspace_closed(self.popups, self.owner_socket, "w1")
        self.assertEqual(self.live(), ["pwd", "sess", "ws2"])

    def test_a_closed_workspace_closes_its_popups_before_the_sweep_sees_it(self):
        self.standard_popups()
        hooks.workspace_closed(self.popups, self.owner_socket, "w1")
        self.assertEqual(self.live(), ["pwd", "sess", "ws2"])

    def test_tab_closed_then_workspace_closed_for_the_last_tab(self):
        # Closing the last tab of a workspace sends tab.closed, then workspace.closed.
        self.standard_popups()
        self.owners.sessions[self.owner_socket] = ["w1:t1", "w1:t2"]
        hooks.tab_closed(self.popups, self.owner_socket, "w2:t1")
        hooks.workspace_closed(self.popups, self.owner_socket, "w2")
        self.assertEqual(self.live(), ["pwd", "sess", "tab", "tab2", "ws"])
        self.assertEqual(len(self.popups.closed), 1)

    def test_the_same_ids_in_another_session_are_not_closed(self):
        other = self.session("other", ["w1:t1"])
        self.popup("their-tab", "tab", "w1", "w1:t1", other)
        self.popup("their-ws", "workspace", "w1", socket=other)
        hooks.tab_closed(self.popups, self.owner_socket, "w1:t1")
        hooks.workspace_closed(self.popups, self.owner_socket, "w1")
        self.assertEqual(self.popups.closed, [])

    def test_sweep_closes_popups_of_missing_tabs_workspaces_and_sessions(self):
        self.standard_popups()
        self.popup("gone-tab", "tab", "w1", "w1:t9")
        self.popup("gone-ws", "workspace", "w9")
        gone = str(self.root / "gone.sock")
        for scope in ("tab", "workspace", "pwd", "session"):
            self.popup(f"gone-{scope}-session", scope, "w1", "w1:t1" if scope == "tab" else None,
                       gone)
        popups.sweep(self.popups)
        self.assertEqual(self.live(), ["pwd", "sess", "tab", "tab2", "ws", "ws2"])

    def test_sweep_keeps_popups_of_a_session_that_does_not_answer_in_time(self):
        slow = self.session("slow", [])
        self.owners.slow.add(slow)
        self.popup("slow-tab", "tab", "w1", "w1:t1", slow)
        self.popup("slow-pwd", "pwd", socket=slow)
        popups.sweep(self.popups)
        self.assertEqual(self.popups.closed, [])

    def test_sweep_closes_workspaces_without_a_matching_record(self):
        self.popup("sess", "session")
        self.popups.add("x1", "restored-after-restart")
        self.popups.add("x2", "sess", terminal_id="term-new")
        popups.sweep(self.popups)
        self.assertEqual(sorted(self.popups.closed), ["x1", "x2"])

    def test_sweep_removes_records_without_a_workspace(self):
        backing = self.popup("sess", "session")
        del self.popups.workspaces[backing]
        popups.sweep(self.popups)
        self.assertIsNone(popups.load_record("sess"))

    def test_hooks_wait_longer_for_owner_sessions_than_a_toggle(self):
        self.popup("ws", "workspace", "w1")
        hooks.workspace_closed(self.popups, self.owner_socket, "w9")
        hooks.tab_closed(self.popups, self.owner_socket, "w9:t1")
        self.assertEqual(set(self.owners.timeouts), {popups.HOOK_OWNER_TIMEOUT})
        self.assertGreater(popups.HOOK_OWNER_TIMEOUT, popups.TOGGLE_OWNER_TIMEOUT)

    def test_sweep_uses_the_owner_timeout_it_gets(self):
        self.popup("ws", "workspace", "w1")
        popups.sweep(self.popups, popups.TOGGLE_OWNER_TIMEOUT)
        self.assertEqual(self.owners.timeouts, [popups.TOGGLE_OWNER_TIMEOUT])

    def test_a_hook_does_not_touch_a_server_with_plugins(self):
        # A toggle-popup server that the user started by hand holds the user's
        # own workspaces: a sweep there would close them.
        self.standard_popups()
        self.popups.add("w9", "my-work")
        self.popups.plugins = [{"plugin_id": "dotfiles.navigation"}]
        self.popups.alive = lambda: True
        patcher = mock.patch.object(herdr_api, "popup_herdr", lambda: self.popups)
        patcher.start()
        self.addCleanup(patcher.stop)
        for mode in ("tab-closed", "workspace-closed", "startup"):
            with self.subTest(mode=mode):
                event = {"data": {"tab_id": "w1:t1", "workspace_id": "w1"}}
                with self.assertRaisesRegex(herdr_api.HerdrError, "not started by toggle-popup"):
                    hooks.handle(mode, self.owner_socket, event)
                self.assertEqual(self.popups.closed, [])

    def test_each_hook_mode_runs_its_cleanup(self):
        backings = self.standard_popups()
        patcher = mock.patch.object(herdr_api, "popup_herdr", lambda: self.popups)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.popups.alive = lambda: True
        event = {"data": {"tab_id": "w1:t1", "workspace_id": "w1"}}
        self.assertTrue(hooks.handle("tab-closed", self.owner_socket, event))
        self.assertEqual(self.popups.closed, [backings["tab"]])
        self.assertTrue(hooks.handle("workspace-closed", self.owner_socket, event))
        self.assertEqual(self.live(), ["pwd", "sess", "ws2"])
        self.owners.sessions.clear()
        self.assertTrue(hooks.handle("startup", self.owner_socket, {}))
        self.assertEqual(self.live(), [])
        with self.assertRaisesRegex(ValueError, "unknown hook: bogus"):
            hooks.handle("bogus", self.owner_socket, {})


class HookErrors(unittest.TestCase):
    def test_a_hook_error_goes_only_to_stderr(self):
        toasts = []

        class Main:
            def __init__(self, endpoint, timeout=5.0):
                self.endpoint = endpoint

            def notify(self, title, body):
                toasts.append((self.endpoint, title, body))

        def fail(mode, endpoint, event):
            raise RuntimeError("popup session broke")

        endpoint = "/x/herdr/sessions/work/herdr.sock"
        patch_env(self, HERDR_SOCKET_PATH=endpoint, HERDR_PLUGIN_EVENT_JSON="{}")
        for patcher in (mock.patch.object(herdr_api, "Herdr", Main),
                        mock.patch.object(hooks, "handle", fail)):
            patcher.start()
            self.addCleanup(patcher.stop)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = hooks.main(["hooks.py", "startup"])
        self.assertEqual(code, 1)
        # No key press caused the hook, so it shows no toast.
        self.assertEqual(toasts, [])
        self.assertEqual(stderr.getvalue(),
                         "toggle-popup: hook: RuntimeError: popup session broke\n")


if __name__ == "__main__":
    unittest.main()
