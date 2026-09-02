#!/bin/sh
set -eu

real_tmux=${SIDE_QUESTS_E2E_REAL_TMUX:?}
arm=${PI_CODING_AGENT_DIR:?}/title-selection-race.arm
selected=${PI_CODING_AGENT_DIR:?}/title-selection-race.selected
release=${PI_CODING_AGENT_DIR:?}/title-selection-race.release

if [ -z "${PI_SIDE_QUESTS_CHILD_ID:-}" ] && [ "${1:-}" = "list-windows" ] && [ -e "$arm" ] && [ ! -e "$selected" ]; then
  output=$($real_tmux "$@")
  status=$?
  printf '%s\n' "$output"
  if [ "$status" -eq 0 ]; then
    printf 'selected\n' > "$selected"
    while [ ! -e "$release" ]; do sleep 0.01; done
  fi
  exit "$status"
fi

exec "$real_tmux" "$@"
