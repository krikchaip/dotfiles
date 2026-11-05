#!/bin/sh
# Run the E2E tests on this machine. Each test class uses its own isolated
# XDG folders, HOME, tmux server, and Herdr sessions (main session: tp-e2e).
# Arguments go to unittest, for example: ./run-host.sh test_popups.RealBinds
# The unit tests have their own script: ../run-unit.sh
set -eu
cd "$(dirname "$0")"

# The user's plugin list is global. Prove that the tests did not change it.
registry="${XDG_CONFIG_HOME:-$HOME/.config}/herdr/plugins.json"
before=$(cksum < "$registry" 2>/dev/null || echo none)
[ "$#" -gt 0 ] || set -- test_popups
status=0
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v "$@" || status=$?
after=$(cksum < "$registry" 2>/dev/null || echo none)
if [ "$before" != "$after" ]; then
    echo "error: the tests changed $registry" >&2
    exit 1
fi
exit "$status"
