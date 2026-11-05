#!/usr/bin/env python3
"""Plugin hooks: close popups whose owner is gone.

  tab-closed        close the tab popups of the closed tab
  workspace-closed  close the workspace popups of the closed workspace, and
                    the tab popups of its tabs
  startup           sweep: close popups whose owner tab, workspace or session is gone

The plugin's own popup server loads no plugins (see
herdr_api.popup_session_command()), so the hooks run only in the user's
sessions. A hook refuses a popup server that the user started by hand (see
herdr_api.check_popup_server()): its sweep could close the user's work there.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

# The version check runs first: the other modules need Python 3.11. A hook
# writes its errors only to stderr (see main()). An old Python runs this
# file again on a newer one, so it imports nothing more.
from python_guard import require_python

require_python("hook", show_toast=False)

import json

import herdr_api
import popups


def tab_closed(popups_herdr, endpoint, tab_id):
    """Close the popups of `tab_id` in the session at `endpoint`, then sweep."""
    popups.close_owned(popups_herdr, endpoint, tab_id=tab_id)
    popups.sweep(popups_herdr)


def workspace_closed(popups_herdr, endpoint, workspace_id):
    """Close the popups of `workspace_id` and its tabs in the session at `endpoint`, then sweep.

    Herdr sends no tab.closed for the tabs of a closed workspace. When the
    last tab of a workspace closes, both events come; the second one finds
    nothing more to close.
    """
    popups.close_owned(popups_herdr, endpoint, workspace_id=workspace_id)
    popups.sweep(popups_herdr)


def handle(mode, endpoint, event):
    """Run one hook. Return True when it looked at the popup session."""
    if not endpoint:
        return False
    popups_herdr = herdr_api.popup_herdr()
    # Without a running popup session there are no popups to close.
    if not popups_herdr.alive():
        return False
    herdr_api.check_popup_server(popups_herdr)
    with popups.popup_lock():
        if mode == "tab-closed":
            tab_closed(popups_herdr, endpoint, event["data"]["tab_id"])
        elif mode == "workspace-closed":
            workspace_closed(popups_herdr, endpoint, event["data"]["workspace_id"])
        elif mode == "startup":
            popups.sweep(popups_herdr)
        else:
            raise ValueError(f"unknown hook: {mode}")
    return True


def main(argv=None):
    """Run the hook named in argv[1].

    A hook writes its errors only to stderr, never as a toast: no key press
    caused it, and the sweep of the next toggle repairs what it missed.
    """
    argv = sys.argv if argv is None else argv
    try:
        if len(argv) < 2:
            raise ValueError("no hook name: use tab-closed, workspace-closed or startup")
        event = json.loads(os.environ.get("HERDR_PLUGIN_EVENT_JSON") or "{}")
        handle(argv[1], os.environ.get("HERDR_SOCKET_PATH"), event)
    except Exception as error:
        herdr_api.log_error("hook", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
