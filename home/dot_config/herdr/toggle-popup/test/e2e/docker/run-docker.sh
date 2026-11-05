#!/bin/sh
# Build the images, run the E2E tests in the client container, and remove the containers.
# Arguments replace the test command, for example:
#   ./run-docker.sh python3 -m unittest -v test_popups.RemoteMachine
set -eu
cd "$(dirname "$0")"
status=0
docker compose build --quiet
docker compose run --rm client "$@" || status=$?
docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
exit "$status"
