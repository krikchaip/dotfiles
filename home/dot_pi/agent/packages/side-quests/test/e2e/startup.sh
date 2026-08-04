#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
runtime_dir="$HOME/.pi/agent/packages/side-quests"
expect_script="$root/test/e2e/startup.expect"
runner="$root/test/e2e/run-in-tmux.sh"
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/side-quests-e2e.XXXXXX")
server="side-quests-e2e-$$"
success=false

cleanup() {
  tmux -L "$server" kill-server 2>/dev/null || true
  if [ "$success" = true ]; then
    rm -rf "$run_dir"
  else
    printf 'Side Quests E2E evidence: %s\n' "$run_dir" >&2
  fi
}
trap cleanup EXIT INT TERM

chezmoi apply "$runtime_dir"
[ -f "$runtime_dir/index.ts" ] || {
  printf 'Applied Side Quests runtime is missing: %s\n' "$runtime_dir/index.ts" >&2
  exit 1
}

run_direct() {
  mode=$1
  log="$run_dir/$mode.ansi"
  "$expect_script" "$mode" "$runtime_dir/index.ts" "$run_dir/$mode-cwd" "$run_dir/$mode-state" "$log"
}

run_tmux() {
  mode=$1
  log="$run_dir/$mode.ansi"
  status="$run_dir/$mode.status"
  tmux -L "$server" new-session -d -x 80 -y 30 \
    "$runner '$expect_script' '$mode' '$runtime_dir/index.ts' '$run_dir/$mode-cwd' '$run_dir/$mode-state' '$log' '$status'"

  deadline=$(( $(date +%s) + 15 ))
  while [ ! -f "$status" ] && [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 1
  done
  [ -f "$status" ] || {
    tmux -L "$server" capture-pane -pt 0 -S -200 >&2 || true
    printf 'Timed out: %s did not complete\n' "$mode" >&2
    exit 1
  }
  [ "$(cat "$status")" = 0 ] || exit 1
}

assert_log() {
  mode=$1
  log="$run_dir/$mode.ansi"
  python3 - "$mode" "$log" <<'PY'
from pathlib import Path
from sys import argv

mode, path = argv[1:]
text = Path(path).read_text(errors="replace")
warning = "Side Quests: tmux is required; extension is inactive."
if mode == "outside":
    if text.count(warning) != 1:
        raise SystemExit(f"expected one unsupported-tmux warning, found {text.count(warning)}")
else:
    if warning in text:
        raise SystemExit("tmux run showed the unsupported-tmux warning")
for forbidden in ("Failed to load extension", "Extension error"):
    if forbidden in text:
        raise SystemExit(f"unexpected Pi extension failure: {forbidden}")
print(f"PASS {mode} startup")
PY
}

run_direct outside
run_tmux parent
run_tmux child
assert_log outside
assert_log parent
assert_log child
success=true
printf 'PASS Side Quests startup E2E\n'
