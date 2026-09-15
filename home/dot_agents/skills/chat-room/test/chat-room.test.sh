#!/usr/bin/env bash
set -u

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -f "$PACKAGE_DIR/scripts/chat-room.sh" ]; then
  SCRIPT="$PACKAGE_DIR/scripts/chat-room.sh"
else
  SCRIPT="$PACKAGE_DIR/scripts/executable_chat-room.sh"
fi
ORIGINAL_TMPDIR=${TMPDIR-}
TEST_COUNT=0
FAIL_COUNT=0

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  return 1
}

assert_contains() {
  case $1 in
    *"$2"*) ;;
    *) fail "expected output to contain [$2], got [$1]" ;;
  esac
}

assert_eq() {
  [ "$1" = "$2" ] || fail "expected [$2], got [$1]"
}

field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1
}

wait_for_pid() {
  pid=$1
  attempts=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 100 ]; do
    sleep 0.05
    attempts=$((attempts + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    fail 'background command did not finish'
    return 1
  fi
  wait "$pid"
}

run_failing() {
  if "$@" > "$CASE_DIR/failure.out" 2> "$CASE_DIR/failure.err"; then
    fail 'command unexpectedly succeeded'
    return 1
  fi
  FAILURE_ERROR=$(cat "$CASE_DIR/failure.err")
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

hash_resume_id() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  fi
}

setup_case() {
  CASE_DIR=$(mktemp -d "${ORIGINAL_TMPDIR:-/tmp}/chat-room-test.XXXXXX") || return 1
  TMPDIR="$CASE_DIR/tmp"
  export TMPDIR
  mkdir -p "$TMPDIR"
}

teardown_case() {
  rm -rf -- "$CASE_DIR"
}

run_case() {
  name=$1
  shift
  TEST_COUNT=$((TEST_COUNT + 1))
  if (setup_case && trap teardown_case EXIT HUP INT TERM && "$@"); then
    printf 'ok %d - %s\n' "$TEST_COUNT" "$name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf 'not ok %d - %s\n' "$TEST_COUNT" "$name"
  fi
}

test_create_claims_peer_a() {
  output=$(bash "$SCRIPT" create --room alpha) || return 1
  assert_contains "$output" 'EVENT=created' || return 1
  assert_contains "$output" 'ROOM_ID=alpha' || return 1
  assert_contains "$output" 'PEER=peer-a' || return 1
  resume=$(field "$output" RESUME_ID)
  [ -n "$resume" ] || fail 'create returned no Resume ID' || return 1
  [ -d "$TMPDIR/agent-chat-rooms/alpha" ] || fail 'room directory was not created'
}

test_create_without_name_generates_safe_unique_room() {
  first=$(bash "$SCRIPT" create) || return 1
  second=$(bash "$SCRIPT" create) || return 1
  first_room=$(field "$first" ROOM_ID)
  second_room=$(field "$second" ROOM_ID)
  printf '%s\n%s\n' "$first_room" "$second_room" | grep -Eq '^chat-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$' || fail 'generated Room ID was not safe and human-readable' || return 1
  [ "$first_room" != "$second_room" ] || fail 'generated Room IDs were not unique'
}

test_join_receives_initial_message() {
  printf '# Work request\n\nInspect the parser.\n' > "$CASE_DIR/message.md"
  created=$(bash "$SCRIPT" create --room initial --message-file "$CASE_DIR/message.md") || return 1
  assert_eq "$(field "$created" MESSAGE_ID)" '00000000000000000002' || return 1

  joined=$(bash "$SCRIPT" join --room initial) || return 1
  assert_contains "$joined" 'EVENT=joined' || return 1
  assert_contains "$joined" 'PEER=peer-b' || return 1
  assert_contains "$joined" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$joined" 'MESSAGE_ID=00000000000000000002' || return 1
  resume=$(field "$joined" RESUME_ID)
  [ -n "$resume" ] || fail 'join returned no Resume ID' || return 1
  path=$(field "$joined" MESSAGE_PATH)
  assert_eq "$(cat "$path")" "$(cat "$CASE_DIR/message.md")"
}

new_pair() {
  PAIR_CREATED=$(bash "$SCRIPT" create --room "$1") || return 1
  PEER_A_RESUME=$(field "$PAIR_CREATED" RESUME_ID)
  PAIR_JOINED=$(bash "$SCRIPT" join --room "$1") || return 1
  PEER_B_RESUME=$(field "$PAIR_JOINED" RESUME_ID)
}

test_send_and_resume_preserve_order_and_redelivery() {
  new_pair ordered || return 1
  sent_a1=$(printf 'from a one\n' | bash "$SCRIPT" send --room ordered --resume "$PEER_A_RESUME") || return 1
  printf 'from b\n' > "$CASE_DIR/from-b.md"
  sent_b=$(bash "$SCRIPT" send --room ordered --resume "$PEER_B_RESUME" --file "$CASE_DIR/from-b.md") || return 1
  sent_a2=$(printf 'from a two\n' | bash "$SCRIPT" send --room ordered --resume "$PEER_A_RESUME") || return 1
  assert_eq "$(field "$sent_a1" MESSAGE_ID)" '00000000000000000003' || return 1
  assert_eq "$(field "$sent_b" MESSAGE_ID)" '00000000000000000004' || return 1
  assert_eq "$(field "$sent_a2" MESSAGE_ID)" '00000000000000000005' || return 1

  resumed_a=$(bash "$SCRIPT" resume --room ordered --resume "$PEER_A_RESUME") || return 1
  assert_contains "$resumed_a" 'EVENT=resumed' || return 1
  assert_contains "$resumed_a" 'PEER=peer-a' || return 1
  assert_contains "$resumed_a" 'MESSAGE_COUNT=2' || return 1
  assert_contains "$resumed_a" 'MESSAGE_ID=00000000000000000002' || return 1
  assert_contains "$resumed_a" 'MESSAGE_ID=00000000000000000004' || return 1

  resumed_b=$(bash "$SCRIPT" resume --room ordered --resume "$PEER_B_RESUME") || return 1
  ids=$(printf '%s\n' "$resumed_b" | sed -n 's/^MESSAGE_ID=//p')
  assert_eq "$ids" "00000000000000000003
00000000000000000005" || return 1

  redelivered=$(bash "$SCRIPT" resume --room ordered --resume "$PEER_B_RESUME") || return 1
  assert_eq "$(printf '%s\n' "$redelivered" | sed -n 's/^MESSAGE_ID=//p')" "$ids"
}

test_ack_and_watch_acknowledges_then_wakes() {
  new_pair wake || return 1
  first=$(printf 'first\n' | bash "$SCRIPT" send --room wake --resume "$PEER_A_RESUME") || return 1
  first_id=$(field "$first" MESSAGE_ID)

  bash "$SCRIPT" ack-and-watch --room wake --resume "$PEER_B_RESUME" --ack "$first_id" --interval 0.05 > "$CASE_DIR/watch.out" 2> "$CASE_DIR/watch.err" &
  watcher=$!
  sleep 0.15
  second=$(printf 'second\n' | bash "$SCRIPT" send --room wake --resume "$PEER_A_RESUME") || return 1
  second_id=$(field "$second" MESSAGE_ID)
  wait_for_pid "$watcher" || { cat "$CASE_DIR/watch.err" >&2; return 1; }

  watched=$(cat "$CASE_DIR/watch.out")
  assert_contains "$watched" 'EVENT=messages' || return 1
  assert_contains "$watched" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$watched" "MESSAGE_ID=$second_id" || return 1
  case $watched in *"MESSAGE_ID=$first_id"*) fail 'acknowledged message was redelivered'; return 1 ;; esac

  resumed=$(bash "$SCRIPT" resume --room wake --resume "$PEER_B_RESUME") || return 1
  assert_contains "$resumed" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$resumed" "MESSAGE_ID=$second_id"
}

test_watch_returns_existing_unread_batch() {
  new_pair existing || return 1
  printf 'ready\n' | bash "$SCRIPT" send --room existing --resume "$PEER_A_RESUME" >/dev/null || return 1
  output=$(bash "$SCRIPT" watch --room existing --resume "$PEER_B_RESUME" --interval 0.05) || return 1
  assert_contains "$output" 'EVENT=messages' || return 1
  assert_contains "$output" 'MESSAGE_COUNT=1'
}

test_full_room_rejects_join_without_change() {
  new_pair full || return 1
  cp "$TMPDIR/agent-chat-rooms/full/manifest" "$CASE_DIR/manifest.before"
  run_failing bash "$SCRIPT" join --room full || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=room-full' || return 1
  cmp "$CASE_DIR/manifest.before" "$TMPDIR/agent-chat-rooms/full/manifest" || fail 'failed join changed manifest'
}

test_invalid_resume_id_cannot_assume_peer() {
  new_pair credentials || return 1
  run_failing bash "$SCRIPT" resume --room credentials --resume not-a-secret || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id' || return 1
  : > "$CASE_DIR/empty-message.md"
  run_failing bash "$SCRIPT" send --room credentials --resume not-a-secret --file "$CASE_DIR/empty-message.md" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id' || return 1
  assert_eq "$(find "$TMPDIR/agent-chat-rooms/credentials/messages" -type f | wc -l | tr -d ' ')" '2'
}

test_room_names_are_bounded_and_safe() {
  for name in '' '../escape' '.hidden' '-option' 'bad/name' 'bad name' 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijkl'; do
    run_failing bash "$SCRIPT" create --room "$name" || return 1
    assert_contains "$FAILURE_ERROR" 'ERROR=invalid-room-name' || return 1
  done
  [ ! -e "$TMPDIR/escape" ] || fail 'unsafe name escaped room root'
}

test_storage_and_credentials_are_private() {
  created=$(bash "$SCRIPT" create --room private) || return 1
  resume=$(field "$created" RESUME_ID)
  room="$TMPDIR/agent-chat-rooms/private"
  assert_eq "$(file_mode "$TMPDIR/agent-chat-rooms")" '700' || return 1
  assert_eq "$(file_mode "$room")" '700' || return 1
  assert_eq "$(file_mode "$room/manifest")" '600' || return 1
  assert_eq "$(file_mode "$room/sequence")" '600' || return 1
  if grep -F "$resume" "$room/manifest" >/dev/null; then
    fail 'manifest stored raw Resume ID'
  fi
}

test_missing_corrupt_rooms_and_stale_locks_are_explicit() {
  run_failing bash "$SCRIPT" resume --room absent --resume secret || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=room-missing' || return 1

  new_pair damaged || return 1
  printf 'VERSION=999\nPEER_A_HASH=x\nPEER_B_HASH=y\n' > "$TMPDIR/agent-chat-rooms/damaged/manifest"
  run_failing bash "$SCRIPT" resume --room damaged --resume "$PEER_A_RESUME" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=corrupt-room' || return 1

  created=$(bash "$SCRIPT" create --room stale) || return 1
  resume=$(field "$created" RESUME_ID)
  mkdir "$TMPDIR/agent-chat-rooms/stale/locks/room.lock"
  printf '99999999\n' > "$TMPDIR/agent-chat-rooms/stale/locks/room.lock/pid"
  sent=$(printf 'after stale lock\n' | bash "$SCRIPT" send --room stale --resume "$resume") || return 1
  assert_contains "$sent" 'EVENT=sent'
}

test_resume_id_rotation_changes_only_other_peer() {
  new_pair rotate || return 1
  rotated=$(bash "$SCRIPT" rotate --room rotate --resume "$PEER_A_RESUME" --peer peer-b) || return 1
  assert_contains "$rotated" 'EVENT=rotated' || return 1
  assert_contains "$rotated" 'PEER=peer-b' || return 1
  replacement=$(field "$rotated" RESUME_ID)
  [ -n "$replacement" ] || fail 'rotation returned no replacement Resume ID' || return 1

  run_failing bash "$SCRIPT" resume --room rotate --resume "$PEER_B_RESUME" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id' || return 1
  resumed=$(bash "$SCRIPT" resume --room rotate --resume "$replacement") || return 1
  assert_contains "$resumed" 'PEER=peer-b' || return 1

  run_failing bash "$SCRIPT" rotate --room rotate --resume "$PEER_A_RESUME" --peer peer-a || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-rotation-target'
}

test_inspection_lists_status_and_history() {
  new_pair bravo || return 1
  bash "$SCRIPT" create --room alpha >/dev/null || return 1
  sent_a=$(printf 'one\n' | bash "$SCRIPT" send --room bravo --resume "$PEER_A_RESUME") || return 1
  sent_b=$(printf 'two\n' | bash "$SCRIPT" send --room bravo --resume "$PEER_B_RESUME") || return 1

  listed=$(bash "$SCRIPT" list) || return 1
  assert_contains "$listed" 'EVENT=rooms' || return 1
  assert_contains "$listed" 'ROOM_COUNT=2' || return 1
  assert_eq "$(printf '%s\n' "$listed" | sed -n 's/^ROOM_ID=//p')" "alpha
bravo" || return 1

  status=$(bash "$SCRIPT" status --room bravo --resume "$PEER_B_RESUME") || return 1
  assert_contains "$status" 'PEER_A=assigned' || return 1
  assert_contains "$status" 'PEER_B=assigned' || return 1
  assert_contains "$status" 'PEER=peer-b' || return 1
  assert_contains "$status" 'UNREAD_COUNT=1' || return 1

  history=$(bash "$SCRIPT" history --room bravo --resume "$PEER_A_RESUME") || return 1
  assert_contains "$history" 'EVENT=history' || return 1
  assert_contains "$history" 'MESSAGE_COUNT=4' || return 1
  assert_eq "$(printf '%s\n' "$history" | sed -n 's/^MESSAGE_SENDER=//p')" "system
system
peer-a
peer-b" || return 1
  assert_eq "$(printf '%s\n' "$history" | sed -n 's/^MESSAGE_ID=//p' | tail -n 2)" "$(field "$sent_a" MESSAGE_ID)
$(field "$sent_b" MESSAGE_ID)"
}

test_concurrent_sends_have_one_global_order() {
  new_pair concurrent || return 1
  pids=
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ $((i % 2)) -eq 0 ]; then resume=$PEER_A_RESUME; else resume=$PEER_B_RESUME; fi
    (printf 'message %s\n' "$i" | bash "$SCRIPT" send --room concurrent --resume "$resume" > "$CASE_DIR/send-$i.out") &
    pids="$pids $!"
  done
  for pid in $pids; do
    wait "$pid" || return 1
  done

  history=$(bash "$SCRIPT" history --room concurrent --resume "$PEER_A_RESUME") || return 1
  ids=$(printf '%s\n' "$history" | sed -n 's/^MESSAGE_ID=//p')
  assert_eq "$ids" "00000000000000000001
00000000000000000002
00000000000000000003
00000000000000000004
00000000000000000005
00000000000000000006
00000000000000000007
00000000000000000008
00000000000000000009
00000000000000000010
00000000000000000011
00000000000000000012" || return 1
  assert_eq "$(find "$TMPDIR/agent-chat-rooms/concurrent/messages" -type f -name '*.md' | wc -l | tr -d ' ')" '12'
}

test_invalid_ack_batch_changes_nothing() {
  new_pair ackfail || return 1
  first=$(printf 'one\n' | bash "$SCRIPT" send --room ackfail --resume "$PEER_A_RESUME") || return 1
  second=$(printf 'two\n' | bash "$SCRIPT" send --room ackfail --resume "$PEER_A_RESUME") || return 1
  run_failing bash "$SCRIPT" ack-and-watch --room ackfail --resume "$PEER_B_RESUME" --ack "$(field "$first" MESSAGE_ID)" --ack 99999999999999999999 --interval 0.05 || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-message-id' || return 1
  resumed=$(bash "$SCRIPT" resume --room ackfail --resume "$PEER_B_RESUME") || return 1
  assert_contains "$resumed" 'MESSAGE_COUNT=2' || return 1
  assert_contains "$resumed" "MESSAGE_ID=$(field "$second" MESSAGE_ID)"
}

test_concurrent_create_has_one_winner() {
  pids=
  for i in 1 2 3 4 5 6 7 8; do
    bash "$SCRIPT" create --room singleton > "$CASE_DIR/create-$i.out" 2> "$CASE_DIR/create-$i.err" &
    pids="$pids $!"
  done
  successes=0
  for pid in $pids; do
    if wait "$pid"; then successes=$((successes + 1)); fi
  done
  assert_eq "$successes" '1' || return 1
  assert_eq "$(find "$TMPDIR/agent-chat-rooms/singleton" -type d -name '.new-*' | wc -l | tr -d ' ')" '0'
}

test_malformed_hash_marks_room_corrupt() {
  created=$(bash "$SCRIPT" create --room badhash) || return 1
  resume=$(field "$created" RESUME_ID)
  bad_hash=$(printf '%064s' z | tr ' ' a)
  printf 'VERSION=2\nPEER_A_HASH=%s\nPEER_A_BOUNDARY=0\nPEER_B_HASH=\nPEER_B_BOUNDARY=0\n' "$bad_hash" > "$TMPDIR/agent-chat-rooms/badhash/manifest"
  run_failing bash "$SCRIPT" resume --room badhash --resume "$resume" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=corrupt-room'
}

run_case 'create claims peer-a' test_create_claims_peer_a
run_case 'create without name generates safe unique room' test_create_without_name_generates_safe_unique_room
run_case 'join receives initial message' test_join_receives_initial_message
run_case 'send and resume preserve order and redelivery' test_send_and_resume_preserve_order_and_redelivery
run_case 'ack-and-watch acknowledges then wakes' test_ack_and_watch_acknowledges_then_wakes
run_case 'watch returns existing unread batch' test_watch_returns_existing_unread_batch
run_case 'full room rejects join without change' test_full_room_rejects_join_without_change
run_case 'invalid Resume ID cannot assume peer' test_invalid_resume_id_cannot_assume_peer
run_case 'room names are bounded and safe' test_room_names_are_bounded_and_safe
run_case 'storage and credentials are private' test_storage_and_credentials_are_private
run_case 'missing, corrupt, and stale room states are explicit' test_missing_corrupt_rooms_and_stale_locks_are_explicit
run_case 'Resume ID rotation changes only other peer' test_resume_id_rotation_changes_only_other_peer
run_case 'inspection lists status and history' test_inspection_lists_status_and_history
run_case 'concurrent sends have one global order' test_concurrent_sends_have_one_global_order
run_case 'invalid acknowledgment batch changes nothing' test_invalid_ack_batch_changes_nothing
run_case 'concurrent create has one winner' test_concurrent_create_has_one_winner
test_leave_empty_inbox_retires_peer() {
  new_pair leaveempty || return 1
  left=$(bash "$SCRIPT" leave --room leaveempty --resume "$PEER_B_RESUME") || return 1
  assert_contains "$left" 'EVENT=left' || return 1
  assert_contains "$left" 'ROOM_ID=leaveempty' || return 1
  assert_contains "$left" 'PEER=peer-b' || return 1
  assert_contains "$left" 'IDEMPOTENT=false' || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  [ -n "$leave_id" ] || fail 'leave returned no System message ID' || return 1

  status=$(bash "$SCRIPT" status --room leaveempty) || return 1
  assert_contains "$status" 'PEER_A=assigned' || return 1
  assert_contains "$status" 'PEER_B=open' || return 1
  run_failing bash "$SCRIPT" resume --room leaveempty --resume "$PEER_B_RESUME" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id'
}

test_leave_with_unread_inbox_keeps_membership() {
  new_pair leaveunread || return 1
  sent=$(printf 'read before leaving\n' | bash "$SCRIPT" send --room leaveunread --resume "$PEER_A_RESUME") || return 1
  sent_id=$(field "$sent" MESSAGE_ID)
  before_count=$(find "$TMPDIR/agent-chat-rooms/leaveunread/messages" -type f -name '*.md' | wc -l | tr -d ' ')

  result=$(bash "$SCRIPT" leave --room leaveunread --resume "$PEER_B_RESUME") || return 1
  assert_contains "$result" 'EVENT=messages' || return 1
  assert_contains "$result" 'OPERATION=leave' || return 1
  assert_contains "$result" 'PEER=peer-b' || return 1
  assert_contains "$result" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$result" "MESSAGE_ID=$sent_id" || return 1
  assert_eq "$(find "$TMPDIR/agent-chat-rooms/leaveunread/messages" -type f -name '*.md' | wc -l | tr -d ' ')" "$before_count" || return 1

  status=$(bash "$SCRIPT" status --room leaveunread) || return 1
  assert_contains "$status" 'PEER_B=assigned' || return 1
  resumed=$(bash "$SCRIPT" resume --room leaveunread --resume "$PEER_B_RESUME") || return 1
  assert_contains "$resumed" "MESSAGE_ID=$sent_id"
}

test_retired_resume_id_is_idempotent_and_watcher_exits() {
  new_pair retiredwatch || return 1
  first=$(bash "$SCRIPT" leave --room retiredwatch --resume "$PEER_B_RESUME") || return 1
  repeated=$(bash "$SCRIPT" leave --room retiredwatch --resume "$PEER_B_RESUME") || return 1
  assert_contains "$repeated" 'EVENT=left' || return 1
  assert_contains "$repeated" 'IDEMPOTENT=true' || return 1
  assert_eq "$(field "$repeated" MESSAGE_ID)" "$(field "$first" MESSAGE_ID)" || return 1

  watched=$(bash "$SCRIPT" watch --room retiredwatch --resume "$PEER_B_RESUME" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  assert_contains "$watched" 'PEER=peer-b' || return 1
  assert_eq "$(field "$watched" MESSAGE_ID)" "$(field "$first" MESSAGE_ID)" || return 1
  run_failing bash "$SCRIPT" send --room retiredwatch --resume "$PEER_B_RESUME" <<< 'stale' || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id'
}

test_join_claims_open_peer_a_slot() {
  created=$(bash "$SCRIPT" create --room joinaftera) || return 1
  peer_a_resume=$(field "$created" RESUME_ID)
  left=$(bash "$SCRIPT" leave --room joinaftera --resume "$peer_a_resume") || return 1
  assert_contains "$left" 'EVENT=left' || return 1

  peer_b=$(bash "$SCRIPT" join --room joinaftera --peer peer-b) || return 1
  assert_contains "$peer_b" 'PEER=peer-b' || return 1
  replacement=$(bash "$SCRIPT" join --room joinaftera) || return 1
  assert_contains "$replacement" 'EVENT=joined' || return 1
  assert_contains "$replacement" 'PEER=peer-a' || return 1
  replacement_resume=$(field "$replacement" RESUME_ID)
  resumed=$(bash "$SCRIPT" resume --room joinaftera --resume "$replacement_resume") || return 1
  assert_contains "$resumed" 'PEER=peer-a'
}

test_membership_events_are_typed_system_messages() {
  created=$(bash "$SCRIPT" create --room systemevents) || return 1
  peer_a_resume=$(field "$created" RESUME_ID)
  create_system_id=$(field "$created" SYSTEM_MESSAGE_ID)
  [ -n "$create_system_id" ] || fail 'create returned no System message ID' || return 1
  create_path="$TMPDIR/agent-chat-rooms/systemevents/messages/${create_system_id}-system-to-none.md"
  [ -f "$create_path" ] || fail 'create System message is missing' || return 1
  assert_contains "$(cat "$create_path")" 'message-type: system' || return 1
  assert_contains "$(cat "$create_path")" 'event: joined' || return 1
  assert_contains "$(cat "$create_path")" 'peer: peer-a' || return 1

  joined=$(bash "$SCRIPT" join --room systemevents) || return 1
  peer_b_resume=$(field "$joined" RESUME_ID)
  join_system_id=$(field "$joined" SYSTEM_MESSAGE_ID)
  assert_contains "$joined" 'MESSAGE_COUNT=0' || return 1
  resumed_a=$(bash "$SCRIPT" resume --room systemevents --resume "$peer_a_resume") || return 1
  assert_contains "$resumed_a" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$resumed_a" "MESSAGE_ID=$join_system_id" || return 1

  left=$(bash "$SCRIPT" leave --room systemevents --resume "$peer_b_resume") || return 1
  leave_system_id=$(field "$left" MESSAGE_ID)
  resumed_a=$(bash "$SCRIPT" resume --room systemevents --resume "$peer_a_resume") || return 1
  assert_contains "$resumed_a" 'MESSAGE_COUNT=2' || return 1
  assert_contains "$resumed_a" "MESSAGE_ID=$leave_system_id" || return 1

  history=$(bash "$SCRIPT" history --room systemevents --resume "$peer_a_resume") || return 1
  assert_contains "$history" 'MESSAGE_COUNT=3' || return 1
  assert_eq "$(printf '%s\n' "$history" | grep -c '^MESSAGE_TYPE=system$')" '3' || return 1
  assert_eq "$(printf '%s\n' "$history" | grep -c '^MESSAGE_SENDER=system$')" '3'
}

test_replacement_receives_only_open_slot_messages() {
  new_pair replacementboundary || return 1
  old_peer_b_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room replacementboundary --resume "$old_peer_b_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  sent=$(printf 'sent while peer-b is open\n' | bash "$SCRIPT" send --room replacementboundary --resume "$PEER_A_RESUME") || return 1
  sent_id=$(field "$sent" MESSAGE_ID)

  replacement=$(bash "$SCRIPT" join --room replacementboundary --peer peer-b) || return 1
  assert_contains "$replacement" 'PEER=peer-b' || return 1
  assert_contains "$replacement" 'MESSAGE_COUNT=1' || return 1
  assert_contains "$replacement" "MESSAGE_ID=$sent_id" || return 1
  case $replacement in *"MESSAGE_ID=$leave_id"*) fail 'replacement inherited the former Peer Inbox'; return 1 ;; esac
  replacement_resume=$(field "$replacement" RESUME_ID)

  run_failing bash "$SCRIPT" leave --room replacementboundary --resume "$old_peer_b_resume" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=peer-replaced' || return 1
  watched=$(bash "$SCRIPT" watch --room replacementboundary --resume "$old_peer_b_resume" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  resumed=$(bash "$SCRIPT" resume --room replacementboundary --resume "$replacement_resume") || return 1
  assert_contains "$resumed" "MESSAGE_ID=$sent_id"
}

test_both_open_slots_refill_with_preference_then_determinism() {
  created=$(bash "$SCRIPT" create --room bothopen) || return 1
  original_resume=$(field "$created" RESUME_ID)
  left=$(bash "$SCRIPT" leave --room bothopen --resume "$original_resume") || return 1
  assert_contains "$left" 'EVENT=left' || return 1
  status=$(bash "$SCRIPT" status --room bothopen) || return 1
  assert_contains "$status" 'PEER_A=open' || return 1
  assert_contains "$status" 'PEER_B=open' || return 1

  preferred=$(bash "$SCRIPT" join --room bothopen --peer peer-b) || return 1
  assert_contains "$preferred" 'PEER=peer-b' || return 1
  deterministic=$(bash "$SCRIPT" join --room bothopen) || return 1
  assert_contains "$deterministic" 'PEER=peer-a' || return 1
  status=$(bash "$SCRIPT" status --room bothopen) || return 1
  assert_contains "$status" 'PEER_A=assigned' || return 1
  assert_contains "$status" 'PEER_B=assigned'
}

test_concurrent_leave_rejects_authenticated_stale_send() {
  new_pair leaverace || return 1
  room="$TMPDIR/agent-chat-rooms/leaverace"
  mkdir "$room/locks/room.lock" || return 1
  printf '%s\n' "$$" > "$room/locks/room.lock/pid"

  printf 'must not cross generation\n' | bash "$SCRIPT" send --room leaverace --resume "$PEER_B_RESUME" > "$CASE_DIR/stale-send.out" 2> "$CASE_DIR/stale-send.err" &
  sender=$!
  sleep 0.15
  kill -0 "$sender" 2>/dev/null || fail 'send did not block on the room lock' || return 1
  kill -STOP "$sender" || return 1

  bash "$SCRIPT" leave --room leaverace --resume "$PEER_B_RESUME" > "$CASE_DIR/race-leave.out" 2> "$CASE_DIR/race-leave.err" &
  leaver=$!
  sleep 0.1
  rm -f -- "$room/locks/room.lock/pid"
  rmdir -- "$room/locks/room.lock"
  wait_for_pid "$leaver" || { cat "$CASE_DIR/race-leave.err" >&2; kill -CONT "$sender" 2>/dev/null || true; return 1; }

  kill -CONT "$sender" || return 1
  if wait "$sender"; then
    fail 'send authenticated before leave and published after retirement'
    return 1
  fi
  assert_contains "$(cat "$CASE_DIR/stale-send.err")" 'ERROR=invalid-resume-id' || return 1
  assert_eq "$(find "$room/messages" -type f -name '*.md' | wc -l | tr -d ' ')" '3'
}

test_leave_recovers_missing_retirement_record() {
  new_pair crashwindow || return 1
  left=$(bash "$SCRIPT" leave --room crashwindow --resume "$PEER_B_RESUME") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  resume_hash=$(hash_resume_id "$PEER_B_RESUME")
  rm -- "$TMPDIR/agent-chat-rooms/crashwindow/retired/$resume_hash" || return 1

  watched=$(bash "$SCRIPT" watch --room crashwindow --resume "$PEER_B_RESUME" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  assert_eq "$(field "$watched" MESSAGE_ID)" "$leave_id" || return 1
  assert_eq "$(find "$TMPDIR/agent-chat-rooms/crashwindow/messages" -type f -name '*-system-to-*.md' | wc -l | tr -d ' ')" '3'
}

test_leave_recovers_committed_transaction_only() {
  new_pair leavecommit || return 1
  room="$TMPDIR/agent-chat-rooms/leavecommit"
  cp "$room/manifest" "$CASE_DIR/leavecommit.before" || return 1
  old_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room leavecommit --resume "$old_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  resume_hash=$(hash_resume_id "$old_resume")
  [ -d "$room/transactions/$leave_id" ] || fail 'leave transaction was not committed' || return 1
  rm -- "$room/messages/${leave_id}-system-to-peer-a.md" "$room/retired/$resume_hash" || return 1
  cp "$CASE_DIR/leavecommit.before" "$room/manifest" || return 1

  watched=$(bash "$SCRIPT" watch --room leavecommit --resume "$old_resume" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  assert_eq "$(field "$watched" MESSAGE_ID)" "$leave_id" || return 1
  assert_eq "$(find "$room/messages" -type f -name "${leave_id}-*.md" | wc -l | tr -d ' ')" '1' || return 1
  assert_contains "$(cat "$room/manifest")" 'PEER_B_HASH=' || return 1
  assert_contains "$(cat "$room/manifest")" 'PEER_B_BOUNDARY=3' || return 1
  run_failing bash "$SCRIPT" resume --room leavecommit --resume "$old_resume" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id'
}

test_leave_recovers_event_before_manifest() {
  new_pair leaveeventfirst || return 1
  room="$TMPDIR/agent-chat-rooms/leaveeventfirst"
  cp "$room/manifest" "$CASE_DIR/leaveeventfirst.before" || return 1
  old_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room leaveeventfirst --resume "$old_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  rm -- "$room/retired/$(hash_resume_id "$old_resume")" || return 1
  cp "$CASE_DIR/leaveeventfirst.before" "$room/manifest" || return 1

  status=$(bash "$SCRIPT" status --room leaveeventfirst) || return 1
  assert_contains "$status" 'PEER_B=open' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${leave_id}-*.md" | wc -l | tr -d ' ')" '1' || return 1
  run_failing bash "$SCRIPT" send --room leaveeventfirst --resume "$old_resume" <<< 'must stay retired' || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id'
}

test_leave_recovers_retirement_before_manifest() {
  new_pair leaveretirefirst || return 1
  room="$TMPDIR/agent-chat-rooms/leaveretirefirst"
  cp "$room/manifest" "$CASE_DIR/leaveretirefirst.before" || return 1
  old_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room leaveretirefirst --resume "$old_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  rm -- "$room/messages/${leave_id}-system-to-peer-a.md" || return 1
  cp "$CASE_DIR/leaveretirefirst.before" "$room/manifest" || return 1

  repeated=$(bash "$SCRIPT" leave --room leaveretirefirst --resume "$old_resume") || return 1
  assert_contains "$repeated" 'EVENT=left' || return 1
  assert_contains "$repeated" 'IDEMPOTENT=true' || return 1
  assert_eq "$(field "$repeated" MESSAGE_ID)" "$leave_id" || return 1
  assert_eq "$(find "$room/messages" -type f -name "${leave_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_leave_recovers_manifest_before_event() {
  new_pair leavemanifestfirst || return 1
  room="$TMPDIR/agent-chat-rooms/leavemanifestfirst"
  old_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room leavemanifestfirst --resume "$old_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  rm -- "$room/messages/${leave_id}-system-to-peer-a.md" || return 1

  watched=$(bash "$SCRIPT" watch --room leavemanifestfirst --resume "$old_resume" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${leave_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_join_recovers_committed_transaction_only() {
  created=$(bash "$SCRIPT" create --room joincommit) || return 1
  room="$TMPDIR/agent-chat-rooms/joincommit"
  cp "$room/manifest" "$CASE_DIR/joincommit.before" || return 1
  joined=$(bash "$SCRIPT" join --room joincommit) || return 1
  join_id=$(field "$joined" SYSTEM_MESSAGE_ID)
  joined_resume=$(field "$joined" RESUME_ID)
  [ -d "$room/transactions/$join_id" ] || fail 'join transaction was not committed' || return 1
  rm -- "$room/messages/${join_id}-system-to-peer-a.md" || return 1
  cp "$CASE_DIR/joincommit.before" "$room/manifest" || return 1

  resumed=$(bash "$SCRIPT" resume --room joincommit --resume "$joined_resume") || return 1
  assert_contains "$resumed" 'PEER=peer-b' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${join_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_join_recovers_event_before_manifest() {
  created=$(bash "$SCRIPT" create --room joineventfirst) || return 1
  room="$TMPDIR/agent-chat-rooms/joineventfirst"
  cp "$room/manifest" "$CASE_DIR/joineventfirst.before" || return 1
  joined=$(bash "$SCRIPT" join --room joineventfirst) || return 1
  join_id=$(field "$joined" SYSTEM_MESSAGE_ID)
  joined_resume=$(field "$joined" RESUME_ID)
  cp "$CASE_DIR/joineventfirst.before" "$room/manifest" || return 1

  resumed=$(bash "$SCRIPT" resume --room joineventfirst --resume "$joined_resume") || return 1
  assert_contains "$resumed" 'PEER=peer-b' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${join_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_join_recovers_manifest_before_event() {
  created=$(bash "$SCRIPT" create --room joinmanifestfirst) || return 1
  room="$TMPDIR/agent-chat-rooms/joinmanifestfirst"
  joined=$(bash "$SCRIPT" join --room joinmanifestfirst) || return 1
  join_id=$(field "$joined" SYSTEM_MESSAGE_ID)
  joined_resume=$(field "$joined" RESUME_ID)
  rm -- "$room/messages/${join_id}-system-to-peer-a.md" || return 1

  resumed=$(bash "$SCRIPT" resume --room joinmanifestfirst --resume "$joined_resume") || return 1
  assert_contains "$resumed" 'PEER=peer-b' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${join_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_reserved_sequence_is_never_reused() {
  created=$(bash "$SCRIPT" create --room sequencegap) || return 1
  room="$TMPDIR/agent-chat-rooms/sequencegap"
  printf '2\n' > "$room/sequence"
  joined=$(bash "$SCRIPT" join --room sequencegap) || return 1
  assert_eq "$(field "$joined" SYSTEM_MESSAGE_ID)" '00000000000000000003' || return 1
  assert_eq "$(find "$room/messages" -type f -name '00000000000000000002-*.md' | wc -l | tr -d ' ')" '0' || return 1
  sent=$(printf 'after gap\n' | bash "$SCRIPT" send --room sequencegap --resume "$(field "$created" RESUME_ID)") || return 1
  assert_eq "$(field "$sent" MESSAGE_ID)" '00000000000000000004'
}

test_committed_transaction_restores_sequence_high_water() {
  new_pair sequencehighwater || return 1
  room="$TMPDIR/agent-chat-rooms/sequencehighwater"
  old_resume=$PEER_B_RESUME
  left=$(bash "$SCRIPT" leave --room sequencehighwater --resume "$old_resume") || return 1
  leave_id=$(field "$left" MESSAGE_ID)
  printf '2\n' > "$room/sequence"

  watched=$(bash "$SCRIPT" watch --room sequencehighwater --resume "$old_resume" --interval 0.01) || return 1
  assert_contains "$watched" 'EVENT=left' || return 1
  assert_eq "$(cat "$room/sequence")" '3' || return 1
  sent=$(printf 'after recovered leave\n' | bash "$SCRIPT" send --room sequencehighwater --resume "$PEER_A_RESUME") || return 1
  assert_eq "$(field "$sent" MESSAGE_ID)" '00000000000000000004' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${leave_id}-*.md" | wc -l | tr -d ' ')" '1'
}

test_rotate_recovers_committed_join_before_rotation() {
  created=$(bash "$SCRIPT" create --room rotaterecovery) || return 1
  room="$TMPDIR/agent-chat-rooms/rotaterecovery"
  peer_a_resume=$(field "$created" RESUME_ID)
  cp "$room/manifest" "$CASE_DIR/rotaterecovery.before" || return 1
  joined=$(bash "$SCRIPT" join --room rotaterecovery) || return 1
  join_id=$(field "$joined" SYSTEM_MESSAGE_ID)
  joined_resume=$(field "$joined" RESUME_ID)
  rm -- "$room/messages/${join_id}-system-to-peer-a.md" || return 1
  cp "$CASE_DIR/rotaterecovery.before" "$room/manifest" || return 1

  rotated=$(bash "$SCRIPT" rotate --room rotaterecovery --resume "$peer_a_resume" --peer peer-b) || return 1
  replacement=$(field "$rotated" RESUME_ID)
  resumed=$(bash "$SCRIPT" resume --room rotaterecovery --resume "$replacement") || return 1
  assert_contains "$resumed" 'PEER=peer-b' || return 1
  run_failing bash "$SCRIPT" resume --room rotaterecovery --resume "$joined_resume" || return 1
  assert_contains "$FAILURE_ERROR" 'ERROR=invalid-resume-id' || return 1
  assert_eq "$(find "$room/messages" -type f -name "${join_id}-*.md" | wc -l | tr -d ' ')" '1'
}

run_case 'malformed hash marks room corrupt' test_malformed_hash_marks_room_corrupt
run_case 'leave recovers missing retirement record' test_leave_recovers_missing_retirement_record
run_case 'leave recovers committed transaction only' test_leave_recovers_committed_transaction_only
run_case 'leave recovers event before manifest' test_leave_recovers_event_before_manifest
run_case 'leave recovers retirement before manifest' test_leave_recovers_retirement_before_manifest
run_case 'leave recovers manifest before event' test_leave_recovers_manifest_before_event
run_case 'join recovers committed transaction only' test_join_recovers_committed_transaction_only
run_case 'join recovers event before manifest' test_join_recovers_event_before_manifest
run_case 'join recovers manifest before event' test_join_recovers_manifest_before_event
run_case 'reserved sequence is never reused' test_reserved_sequence_is_never_reused
run_case 'committed transaction restores sequence high-water mark' test_committed_transaction_restores_sequence_high_water
run_case 'rotate recovers committed join before rotation' test_rotate_recovers_committed_join_before_rotation
run_case 'leave with empty Inbox retires Peer' test_leave_empty_inbox_retires_peer
run_case 'leave with unread Inbox keeps membership' test_leave_with_unread_inbox_keeps_membership
run_case 'retired Resume ID is idempotent and watcher exits' test_retired_resume_id_is_idempotent_and_watcher_exits
run_case 'join claims open peer-a slot' test_join_claims_open_peer_a_slot
run_case 'membership events are typed System messages' test_membership_events_are_typed_system_messages
run_case 'replacement receives only open-slot messages' test_replacement_receives_only_open_slot_messages
run_case 'both open slots refill by preference then determinism' test_both_open_slots_refill_with_preference_then_determinism
run_case 'concurrent leave rejects authenticated stale send' test_concurrent_leave_rejects_authenticated_stale_send

if [ "$FAIL_COUNT" -ne 0 ]; then
  printf '%d of %d tests failed\n' "$FAIL_COUNT" "$TEST_COUNT" >&2
  exit 1
fi
printf '%d tests passed\n' "$TEST_COUNT"
