#!/usr/bin/env bash
set -euo pipefail

umask 077
readonly PROTOCOL_VERSION=1
readonly ROOT="${TMPDIR:-/tmp}/agent-chat-rooms"
STAGING=
TRANSACTION_STAGING=
HELD_LOCK=
RECOVERY_LOCK=

cleanup() {
  if [ -n "$HELD_LOCK" ]; then
    rm -f -- "$HELD_LOCK/pid" 2>/dev/null || true
    rmdir -- "$HELD_LOCK" 2>/dev/null || true
  fi
  if [ -n "$RECOVERY_LOCK" ]; then
    rm -f -- "$RECOVERY_LOCK/pid" 2>/dev/null || true
    rmdir -- "$RECOVERY_LOCK" 2>/dev/null || true
  fi
  [ -z "$STAGING" ] || rm -rf -- "$STAGING"
  [ -z "$TRANSACTION_STAGING" ] || rm -rf -- "$TRANSACTION_STAGING"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

fail() {
  code=$1
  shift
  printf 'ERROR=%s\n' "$code" >&2
  if [ "$#" -gt 0 ]; then
    printf 'DETAIL=%s\n' "$*" >&2
  fi
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  chat-room.sh create [--room <room-id>] [--message-file <path>]
  chat-room.sh join --room <room-id> [--peer <peer-a|peer-b>]
  chat-room.sh leave --room <room-id> --resume <resume-id>
  chat-room.sh resume --room <room-id> --resume <resume-id>
  chat-room.sh send --room <room-id> --resume <resume-id> [--file <path>]
  chat-room.sh watch --room <room-id> --resume <resume-id> [--interval <seconds>]
  chat-room.sh ack-and-watch --room <room-id> --resume <resume-id> --ack <message-id>... [--interval <seconds>]
  chat-room.sh rotate --room <room-id> --resume <resume-id> --peer <peer-a|peer-b>
  chat-room.sh list
  chat-room.sh status --room <room-id> [--resume <resume-id>]
  chat-room.sh history --room <room-id> --resume <resume-id>
  chat-room.sh --help
EOF
}

random_hex() {
  local bytes value
  bytes=$1
  value=$(od -An -N "$bytes" -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
  [ "${#value}" -eq $((bytes * 2)) ] || fail random-failed 'could not read secure random data'
  printf '%s\n' "$value"
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    fail missing-sha256 'need shasum or sha256sum'
  fi
}

validate_room_id() {
  local room_id
  room_id=$1
  case $room_id in
    ''|.|..) return 1 ;;
    *[!A-Za-z0-9._-]*|[-._]*) return 1 ;;
  esac
  [ "${#room_id}" -le 63 ]
}

validate_message_id() {
  case $1 in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_root() {
  if [ -L "$ROOT" ]; then
    fail unsafe-root "$ROOT is a symbolic link"
  fi
  if [ -e "$ROOT" ] && [ ! -d "$ROOT" ]; then
    fail unsafe-root "$ROOT is not a directory"
  fi
  mkdir -p -- "$ROOT" || fail root-create-failed "$ROOT"
  chmod 700 "$ROOT" || fail root-permission-failed "$ROOT"
}

room_path() {
  validate_room_id "$1" || fail invalid-room-name "$1"
  printf '%s/%s\n' "$ROOT" "$1"
}

require_room() {
  local room room_id
  room_id=$1
  room=$(room_path "$room_id")
  [ -d "$room" ] && [ ! -L "$room" ] || fail room-missing "$room_id"
  [ -f "$room/manifest" ] && [ ! -L "$room/manifest" ] || fail corrupt-room "$room_id: manifest"
  [ -f "$room/sequence" ] && [ ! -L "$room/sequence" ] || fail corrupt-room "$room_id: sequence"
  [ -d "$room/messages" ] && [ -d "$room/acknowledgments/peer-a" ] && [ -d "$room/acknowledgments/peer-b" ] && [ -d "$room/retired" ] && [ -d "$room/transactions" ] && [ -d "$room/locks" ] || fail corrupt-room "$room_id: layout"
  printf '%s\n' "$room"
}

manifest_value() {
  local file key value count
  file=$1
  key=$2
  count=$(grep -c "^${key}=" "$file" || true)
  [ "$count" -eq 1 ] || fail corrupt-room "manifest key $key"
  value=$(sed -n "s/^${key}=//p" "$file")
  printf '%s\n' "$value"
}

validate_hash() {
  [ "${#1}" -eq 64 ] || return 1
  case $1 in *[!0-9a-f]*) return 1 ;; esac
}

validate_boundary() {
  case $1 in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

read_manifest() {
  local room version
  room=$1
  version=$(manifest_value "$room/manifest" VERSION)
  [ "$version" = "$PROTOCOL_VERSION" ] || fail corrupt-room "unsupported protocol $version"
  PEER_A_HASH=$(manifest_value "$room/manifest" PEER_A_HASH)
  PEER_A_BOUNDARY=$(manifest_value "$room/manifest" PEER_A_BOUNDARY)
  PEER_B_HASH=$(manifest_value "$room/manifest" PEER_B_HASH)
  PEER_B_BOUNDARY=$(manifest_value "$room/manifest" PEER_B_BOUNDARY)
  [ -z "$PEER_A_HASH" ] || validate_hash "$PEER_A_HASH" || fail corrupt-room 'peer-a hash'
  [ -z "$PEER_B_HASH" ] || validate_hash "$PEER_B_HASH" || fail corrupt-room 'peer-b hash'
  validate_boundary "$PEER_A_BOUNDARY" || fail corrupt-room 'peer-a boundary'
  validate_boundary "$PEER_B_BOUNDARY" || fail corrupt-room 'peer-b boundary'
}

write_manifest() {
  local destination peer_a_hash peer_a_boundary peer_b_hash peer_b_boundary
  destination=$1
  peer_a_hash=$2
  peer_a_boundary=$3
  peer_b_hash=$4
  peer_b_boundary=$5
  {
    printf 'VERSION=%s\n' "$PROTOCOL_VERSION"
    printf 'PEER_A_HASH=%s\n' "$peer_a_hash"
    printf 'PEER_A_BOUNDARY=%s\n' "$peer_a_boundary"
    printf 'PEER_B_HASH=%s\n' "$peer_b_hash"
    printf 'PEER_B_BOUNDARY=%s\n' "$peer_b_boundary"
  } > "$destination"
  chmod 600 "$destination"
}

identify_peer() {
  local room resume_id resume_hash
  room=$1
  resume_id=$2
  [ -n "$resume_id" ] || fail invalid-resume-id 'empty Resume ID'
  read_manifest "$room"
  resume_hash=$(printf '%s' "$resume_id" | sha256)
  if [ "$resume_hash" = "$PEER_A_HASH" ]; then
    printf 'peer-a\n'
  elif [ -n "$PEER_B_HASH" ] && [ "$resume_hash" = "$PEER_B_HASH" ]; then
    printf 'peer-b\n'
  else
    fail invalid-resume-id 'credential did not match this room'
  fi
}

lock_owner() {
  local lock owner
  lock=$1
  owner=
  if [ -f "$lock/pid" ]; then
    owner=$(cat "$lock/pid" 2>/dev/null || true)
    case $owner in ''|*[!0-9]*) owner= ;; esac
  fi
  printf '%s\n' "$owner"
}

release_recovery_lock() {
  local lock
  lock=$RECOVERY_LOCK
  RECOVERY_LOCK=
  rm -f -- "$lock/pid" 2>/dev/null || true
  rmdir -- "$lock" 2>/dev/null || fail lock-release-failed "$lock"
}

acquire_lock() {
  local lock recovery attempt owner current recovery_owner
  lock=$1
  recovery="${lock}.recovery"
  attempt=0
  while [ "$attempt" -lt 200 ]; do
    if [ -d "$recovery" ]; then
      recovery_owner=$(lock_owner "$recovery")
      if [ -n "$recovery_owner" ] && ! kill -0 "$recovery_owner" 2>/dev/null; then
        rm -rf -- "$recovery" 2>/dev/null || true
      fi
      sleep 0.05
      attempt=$((attempt + 1))
      continue
    fi
    if mkdir -m 700 -- "$lock" 2>/dev/null; then
      HELD_LOCK=$lock
      printf '%s\n' "$$" > "$lock/pid"
      return 0
    fi
    owner=$(lock_owner "$lock")
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      if mkdir -m 700 -- "$recovery" 2>/dev/null; then
        RECOVERY_LOCK=$recovery
        printf '%s\n' "$$" > "$recovery/pid"
        current=$(lock_owner "$lock")
        if [ "$current" = "$owner" ] && ! kill -0 "$current" 2>/dev/null; then
          rm -rf -- "$lock" 2>/dev/null || true
        fi
        release_recovery_lock
        attempt=$((attempt + 1))
        continue
      fi
    fi
    sleep 0.05
    attempt=$((attempt + 1))
  done
  fail lock-unavailable "$lock"
}

release_lock() {
  local lock
  lock=$HELD_LOCK
  HELD_LOCK=
  rm -f -- "$lock/pid" 2>/dev/null || true
  rmdir -- "$lock" 2>/dev/null || fail lock-release-failed "$lock"
}

parse_message_path() {
  local path base suffix
  path=$1
  base=${path##*/}
  MESSAGE_ID=${base%%-*}
  suffix=${base#*-}
  suffix=${suffix%.md}
  validate_message_id "$MESSAGE_ID" || fail corrupt-room "invalid message filename: $base"
  case $suffix in
    peer-a) MESSAGE_TYPE=peer; MESSAGE_SENDER=peer-a; MESSAGE_TARGET=peer-b ;;
    peer-b) MESSAGE_TYPE=peer; MESSAGE_SENDER=peer-b; MESSAGE_TARGET=peer-a ;;
    system-to-peer-a) MESSAGE_TYPE=system; MESSAGE_SENDER=system; MESSAGE_TARGET=peer-a ;;
    system-to-peer-b) MESSAGE_TYPE=system; MESSAGE_SENDER=system; MESSAGE_TARGET=peer-b ;;
    system-to-none) MESSAGE_TYPE=system; MESSAGE_SENDER=system; MESSAGE_TARGET=none ;;
    *) fail corrupt-room "invalid message sender: $base" ;;
  esac
}

reserve_sequence_locked() {
  local room sequence next sequence_tmp
  room=$1
  sequence=$(cat "$room/sequence" 2>/dev/null || true)
  case $sequence in
    ''|*[!0-9]*) fail corrupt-room 'invalid sequence' ;;
  esac
  next=$((sequence + 1))
  [ "$next" -gt "$sequence" ] || fail corrupt-room 'sequence exhausted'
  sequence_tmp=$(mktemp "$room/.sequence.XXXXXX") || fail write-failed 'sequence temporary file'
  printf '%s\n' "$next" > "$sequence_tmp"
  chmod 600 "$sequence_tmp"
  mv -- "$sequence_tmp" "$room/sequence"
  PUBLISHED_ID=$(printf '%020d' "$next")
  PUBLISHED_SEQUENCE=$next
}

publish_message_locked() {
  local room suffix source message_tmp message_path
  room=$1
  suffix=$2
  source=$3
  reserve_sequence_locked "$room"
  message_tmp=$(mktemp "$room/messages/.message.XXXXXX") || fail write-failed 'message temporary file'
  if [ "$source" = '-' ]; then
    cat > "$message_tmp"
  else
    cat -- "$source" > "$message_tmp"
  fi
  chmod 600 "$message_tmp"
  message_path="$room/messages/${PUBLISHED_ID}-${suffix}.md"
  mv -- "$message_tmp" "$message_path"
}

publish_system_message_locked() {
  local room event peer target system_tmp
  room=$1
  event=$2
  peer=$3
  target=$4
  system_tmp=$(mktemp "$room/.system-message.XXXXXX") || fail write-failed 'System message temporary file'
  {
    printf '%s\n' '---'
    printf 'message-type: system\n'
    printf 'event: %s\n' "$event"
    printf 'peer: %s\n' "$peer"
    printf '%s\n' '---'
    printf '\n# Peer %s\n\n`%s` %s the Chat room.\n' "$event" "$peer" "$event"
  } > "$system_tmp"
  chmod 600 "$system_tmp"
  publish_message_locked "$room" "system-to-$target" "$system_tmp"
  rm -f -- "$system_tmp"
}

collect_unread() {
  local room peer path boundary boundary_id
  room=$1
  peer=$2
  read_manifest "$room"
  case $peer in
    peer-a) boundary=$PEER_A_BOUNDARY ;;
    peer-b) boundary=$PEER_B_BOUNDARY ;;
    *) fail corrupt-room "unknown peer: $peer" ;;
  esac
  boundary_id=$(printf '%020d' "$boundary")
  UNREAD_IDS=()
  UNREAD_PATHS=()
  for path in "$room"/messages/*.md; do
    [ -f "$path" ] || continue
    parse_message_path "$path"
    [ "$MESSAGE_TARGET" = "$peer" ] || continue
    [[ "$MESSAGE_ID" > "$boundary_id" ]] || continue
    [ ! -e "$room/acknowledgments/$peer/$MESSAGE_ID" ] || continue
    UNREAD_IDS[${#UNREAD_IDS[@]}]=$MESSAGE_ID
    UNREAD_PATHS[${#UNREAD_PATHS[@]}]=$path
  done
}

print_collected_unread() {
  local index
  printf 'MESSAGE_COUNT=%s\n' "${#UNREAD_IDS[@]}"
  index=0
  while [ "$index" -lt "${#UNREAD_IDS[@]}" ]; do
    printf 'MESSAGE_ID=%s\n' "${UNREAD_IDS[$index]}"
    printf 'MESSAGE_PATH=%s\n' "${UNREAD_PATHS[$index]}"
    index=$((index + 1))
  done
}

print_unread() {
  collect_unread "$1" "$2"
  print_collected_unread
}

create_room() {
  local room_id room_supplied message_file message_supplied room resume_id peer_a_hash system_message_id user_message_id
  room_id=
  room_supplied=0
  message_file=
  message_supplied=0
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; room_supplied=1; shift 2 ;;
      --message-file) [ "$#" -ge 2 ] || fail invalid-arguments '--message-file needs a value'; message_file=$2; message_supplied=1; shift 2 ;;
      *) fail invalid-arguments "unknown create argument: $1" ;;
    esac
  done

  ensure_root
  if [ "$room_supplied" -eq 0 ]; then
    room_id="chat-$(date '+%Y%m%d-%H%M%S')-$(random_hex 4)"
  fi
  validate_room_id "$room_id" || fail invalid-room-name "$room_id"
  [ "$message_supplied" -eq 0 ] || [ -f "$message_file" ] || fail message-file-missing "$message_file"

  room="$ROOT/$room_id"
  [ ! -e "$room" ] && [ ! -L "$room" ] || fail room-already-exists "$room_id"
  STAGING="$ROOT/.new-${room_id}-$$-$(random_hex 3)"
  mkdir -m 700 -- "$STAGING" || fail room-create-failed "$room_id"
  mkdir -m 700 -- "$STAGING/messages" "$STAGING/acknowledgments" "$STAGING/acknowledgments/peer-a" "$STAGING/acknowledgments/peer-b" "$STAGING/retired" "$STAGING/transactions" "$STAGING/locks"
  printf '0\n' > "$STAGING/sequence"
  chmod 600 "$STAGING/sequence"

  resume_id=$(random_hex 32)
  peer_a_hash=$(printf '%s' "$resume_id" | sha256)
  write_manifest "$STAGING/manifest" "$peer_a_hash" 0 '' 0
  acquire_lock "$STAGING/locks/room.lock"
  publish_system_message_locked "$STAGING" joined peer-a none
  system_message_id=$PUBLISHED_ID
  user_message_id=
  if [ "$message_supplied" -eq 1 ]; then
    publish_message_locked "$STAGING" peer-a "$message_file"
    user_message_id=$PUBLISHED_ID
  fi
  release_lock

  acquire_lock "$ROOT/.create.lock"
  [ ! -e "$room" ] && [ ! -L "$room" ] || fail room-already-exists "$room_id"
  mv -- "$STAGING" "$room" || fail room-create-failed "$room_id"
  STAGING=
  release_lock

  printf 'EVENT=created\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=peer-a\n'
  printf 'RESUME_ID=%s\n' "$resume_id"
  printf 'MESSAGE_ID=%s\n' "$user_message_id"
  printf 'SYSTEM_MESSAGE_ID=%s\n' "$system_message_id"
}

join_room() {
  local room_id preferred room resume_id peer peer_hash target system_message_id
  room_id=
  preferred=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --peer) [ "$#" -ge 2 ] || fail invalid-arguments '--peer needs a value'; preferred=$2; shift 2 ;;
      *) fail invalid-arguments "unknown join argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] || fail invalid-arguments 'join needs --room'
  case $preferred in ''|peer-a|peer-b) ;; *) fail invalid-arguments "invalid peer preference: $preferred" ;; esac
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  read_manifest "$room"
  [ -z "$PEER_A_HASH" ] || [ -z "$PEER_B_HASH" ] || fail room-full "$room_id"
  if [ "$preferred" = peer-a ] && [ -z "$PEER_A_HASH" ]; then
    peer=peer-a
  elif [ "$preferred" = peer-b ] && [ -z "$PEER_B_HASH" ]; then
    peer=peer-b
  elif [ -z "$PEER_A_HASH" ]; then
    peer=peer-a
  else
    peer=peer-b
  fi
  resume_id=$(random_hex 32)
  peer_hash=$(printf '%s' "$resume_id" | sha256)
  if [ "$peer" = peer-a ]; then
    if [ -n "$PEER_B_HASH" ]; then target=peer-b; else target=none; fi
    commit_membership_transaction_locked "$room" joined "$peer" "$target" "$peer_hash" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY" \
      "$peer_hash" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY"
  else
    if [ -n "$PEER_A_HASH" ]; then target=peer-a; else target=none; fi
    commit_membership_transaction_locked "$room" joined "$peer" "$target" "$peer_hash" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$peer_hash" "$PEER_B_BOUNDARY"
  fi
  system_message_id=$PUBLISHED_ID
  release_lock

  printf 'EVENT=joined\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=%s\n' "$peer"
  printf 'RESUME_ID=%s\n' "$resume_id"
  printf 'MESSAGE_ID=\n'
  printf 'SYSTEM_MESSAGE_ID=%s\n' "$system_message_id"
  print_unread "$room" "$peer"
}

write_retirement() {
  local room resume_hash peer message_id boundary temporary
  room=$1
  resume_hash=$2
  peer=$3
  message_id=$4
  boundary=$5
  temporary=$(mktemp "$room/retired/.retired.XXXXXX") || fail write-failed 'retirement temporary file'
  {
    printf 'PEER=%s\n' "$peer"
    printf 'MESSAGE_ID=%s\n' "$message_id"
    printf 'BOUNDARY=%s\n' "$boundary"
  } > "$temporary"
  chmod 600 "$temporary"
  mv -- "$temporary" "$room/retired/$resume_hash"
}

read_retirement() {
  local path
  path=$1
  RETIRED_PEER=$(manifest_value "$path" PEER)
  RETIRED_MESSAGE_ID=$(manifest_value "$path" MESSAGE_ID)
  RETIRED_BOUNDARY=$(manifest_value "$path" BOUNDARY)
  case $RETIRED_PEER in peer-a|peer-b) ;; *) fail corrupt-room 'retired Peer' ;; esac
  validate_message_id "$RETIRED_MESSAGE_ID" || fail corrupt-room 'retired message ID'
  validate_boundary "$RETIRED_BOUNDARY" || fail corrupt-room 'retired boundary'
}

transaction_value() {
  local record key value count
  record=$1
  key=$2
  count=$(grep -c "^${key}=" "$record" || true)
  [ "$count" -eq 1 ] || fail corrupt-room "transaction key $key"
  value=$(sed -n "s/^${key}=//p" "$record")
  printf '%s\n' "$value"
}

read_transaction() {
  local transaction record directory_id expected_id expected_target
  transaction=$1
  record="$transaction/record"
  [ -d "$transaction" ] && [ ! -L "$transaction" ] || fail corrupt-room 'transaction directory'
  [ -f "$record" ] && [ ! -L "$record" ] || fail corrupt-room 'transaction record'
  [ -f "$transaction/message.md" ] && [ ! -L "$transaction/message.md" ] || fail corrupt-room 'transaction message'

  TRANSACTION_VERSION=$(transaction_value "$record" TRANSACTION_VERSION)
  TRANSACTION_EVENT=$(transaction_value "$record" EVENT)
  TRANSACTION_PEER=$(transaction_value "$record" PEER)
  TRANSACTION_TARGET=$(transaction_value "$record" TARGET)
  TRANSACTION_RESUME_HASH=$(transaction_value "$record" RESUME_HASH)
  TRANSACTION_MESSAGE_ID=$(transaction_value "$record" MESSAGE_ID)
  TRANSACTION_SEQUENCE=$(transaction_value "$record" SEQUENCE)
  TRANSACTION_BEFORE_A_HASH=$(transaction_value "$record" BEFORE_A_HASH)
  TRANSACTION_BEFORE_A_BOUNDARY=$(transaction_value "$record" BEFORE_A_BOUNDARY)
  TRANSACTION_BEFORE_B_HASH=$(transaction_value "$record" BEFORE_B_HASH)
  TRANSACTION_BEFORE_B_BOUNDARY=$(transaction_value "$record" BEFORE_B_BOUNDARY)
  TRANSACTION_AFTER_A_HASH=$(transaction_value "$record" AFTER_A_HASH)
  TRANSACTION_AFTER_A_BOUNDARY=$(transaction_value "$record" AFTER_A_BOUNDARY)
  TRANSACTION_AFTER_B_HASH=$(transaction_value "$record" AFTER_B_HASH)
  TRANSACTION_AFTER_B_BOUNDARY=$(transaction_value "$record" AFTER_B_BOUNDARY)

  [ "$TRANSACTION_VERSION" = 1 ] || fail corrupt-room 'unsupported transaction'
  case $TRANSACTION_EVENT in joined|left) ;; *) fail corrupt-room 'transaction event' ;; esac
  case $TRANSACTION_PEER in peer-a|peer-b) ;; *) fail corrupt-room 'transaction Peer' ;; esac
  case $TRANSACTION_TARGET in peer-a|peer-b|none) ;; *) fail corrupt-room 'transaction target' ;; esac
  validate_hash "$TRANSACTION_RESUME_HASH" || fail corrupt-room 'transaction Resume ID hash'
  validate_message_id "$TRANSACTION_MESSAGE_ID" || fail corrupt-room 'transaction Message ID'
  validate_boundary "$TRANSACTION_SEQUENCE" || fail corrupt-room 'transaction sequence'
  [ "$TRANSACTION_MESSAGE_ID" = "$(printf '%020d' "$TRANSACTION_SEQUENCE")" ] || fail corrupt-room 'transaction sequence mismatch'

  for TRANSACTION_HASH in "$TRANSACTION_BEFORE_A_HASH" "$TRANSACTION_BEFORE_B_HASH" "$TRANSACTION_AFTER_A_HASH" "$TRANSACTION_AFTER_B_HASH"; do
    [ -z "$TRANSACTION_HASH" ] || validate_hash "$TRANSACTION_HASH" || fail corrupt-room 'transaction membership hash'
  done
  for TRANSACTION_BOUNDARY in "$TRANSACTION_BEFORE_A_BOUNDARY" "$TRANSACTION_BEFORE_B_BOUNDARY" "$TRANSACTION_AFTER_A_BOUNDARY" "$TRANSACTION_AFTER_B_BOUNDARY"; do
    validate_boundary "$TRANSACTION_BOUNDARY" || fail corrupt-room 'transaction membership boundary'
  done

  directory_id=${transaction##*/}
  validate_message_id "$directory_id" || fail corrupt-room 'transaction directory name'
  [ "$directory_id" = "$TRANSACTION_MESSAGE_ID" ] || fail corrupt-room 'transaction directory mismatch'

  if [ "$TRANSACTION_PEER" = peer-a ]; then
    if [ -n "$TRANSACTION_BEFORE_B_HASH" ]; then expected_target=peer-b; else expected_target=none; fi
    [ "$TRANSACTION_BEFORE_B_HASH" = "$TRANSACTION_AFTER_B_HASH" ] && [ "$TRANSACTION_BEFORE_B_BOUNDARY" = "$TRANSACTION_AFTER_B_BOUNDARY" ] || fail corrupt-room 'transaction changed counterpart'
    if [ "$TRANSACTION_EVENT" = joined ]; then
      [ -z "$TRANSACTION_BEFORE_A_HASH" ] && [ "$TRANSACTION_AFTER_A_HASH" = "$TRANSACTION_RESUME_HASH" ] && [ "$TRANSACTION_BEFORE_A_BOUNDARY" = "$TRANSACTION_AFTER_A_BOUNDARY" ] || fail corrupt-room 'invalid peer-a join transaction'
    else
      [ "$TRANSACTION_BEFORE_A_HASH" = "$TRANSACTION_RESUME_HASH" ] && [ -z "$TRANSACTION_AFTER_A_HASH" ] && [ "$TRANSACTION_AFTER_A_BOUNDARY" = "$TRANSACTION_SEQUENCE" ] || fail corrupt-room 'invalid peer-a leave transaction'
    fi
  else
    if [ -n "$TRANSACTION_BEFORE_A_HASH" ]; then expected_target=peer-a; else expected_target=none; fi
    [ "$TRANSACTION_BEFORE_A_HASH" = "$TRANSACTION_AFTER_A_HASH" ] && [ "$TRANSACTION_BEFORE_A_BOUNDARY" = "$TRANSACTION_AFTER_A_BOUNDARY" ] || fail corrupt-room 'transaction changed counterpart'
    if [ "$TRANSACTION_EVENT" = joined ]; then
      [ -z "$TRANSACTION_BEFORE_B_HASH" ] && [ "$TRANSACTION_AFTER_B_HASH" = "$TRANSACTION_RESUME_HASH" ] && [ "$TRANSACTION_BEFORE_B_BOUNDARY" = "$TRANSACTION_AFTER_B_BOUNDARY" ] || fail corrupt-room 'invalid peer-b join transaction'
    else
      [ "$TRANSACTION_BEFORE_B_HASH" = "$TRANSACTION_RESUME_HASH" ] && [ -z "$TRANSACTION_AFTER_B_HASH" ] && [ "$TRANSACTION_AFTER_B_BOUNDARY" = "$TRANSACTION_SEQUENCE" ] || fail corrupt-room 'invalid peer-b leave transaction'
    fi
  fi
  [ "$TRANSACTION_TARGET" = "$expected_target" ] || fail corrupt-room 'transaction target mismatch'
}

transaction_state_matches() {
  [ "$PEER_A_HASH" = "$1" ] && [ "$PEER_A_BOUNDARY" = "$2" ] && [ "$PEER_B_HASH" = "$3" ] && [ "$PEER_B_BOUNDARY" = "$4" ]
}

write_manifest_atomic() {
  local room temporary
  room=$1
  shift
  temporary=$(mktemp "$room/.manifest.XXXXXX") || fail write-failed 'manifest temporary file'
  write_manifest "$temporary" "$@"
  mv -- "$temporary" "$room/manifest"
}

ensure_transaction_sequence_locked() {
  local room sequence temporary
  room=$1
  sequence=$(cat "$room/sequence" 2>/dev/null || true)
  case $sequence in ''|*[!0-9]*) fail corrupt-room 'invalid sequence' ;; esac
  if [ "$sequence" -lt "$TRANSACTION_SEQUENCE" ]; then
    temporary=$(mktemp "$room/.sequence.XXXXXX") || fail write-failed 'sequence recovery file'
    printf '%s\n' "$TRANSACTION_SEQUENCE" > "$temporary"
    chmod 600 "$temporary"
    mv -- "$temporary" "$room/sequence"
  fi
}

ensure_transaction_message_locked() {
  local room transaction expected candidate count temporary
  room=$1
  transaction=$2
  expected="$room/messages/${TRANSACTION_MESSAGE_ID}-system-to-${TRANSACTION_TARGET}.md"
  count=0
  for candidate in "$room/messages/${TRANSACTION_MESSAGE_ID}-"*.md; do
    [ -f "$candidate" ] && [ ! -L "$candidate" ] || continue
    count=$((count + 1))
    [ "$candidate" = "$expected" ] || fail corrupt-room 'transaction Message ID collision'
  done
  [ "$count" -le 1 ] || fail corrupt-room 'duplicate transaction Message ID'
  if [ "$count" -eq 1 ]; then
    cmp -s "$transaction/message.md" "$expected" || fail corrupt-room 'transaction message content mismatch'
    return 0
  fi
  temporary=$(mktemp "$room/messages/.message.XXXXXX") || fail write-failed 'transaction message recovery file'
  cat -- "$transaction/message.md" > "$temporary"
  chmod 600 "$temporary"
  mv -- "$temporary" "$expected"
}

ensure_transaction_retirement_locked() {
  local room expected
  room=$1
  [ "$TRANSACTION_EVENT" = left ] || return 0
  expected="$room/retired/$TRANSACTION_RESUME_HASH"
  if [ -e "$expected" ] || [ -L "$expected" ]; then
    [ -f "$expected" ] && [ ! -L "$expected" ] || fail corrupt-room 'retirement record'
    read_retirement "$expected"
    [ "$RETIRED_PEER" = "$TRANSACTION_PEER" ] && [ "$RETIRED_MESSAGE_ID" = "$TRANSACTION_MESSAGE_ID" ] && [ "$RETIRED_BOUNDARY" = "$TRANSACTION_SEQUENCE" ] || fail corrupt-room 'retirement record mismatch'
  else
    write_retirement "$room" "$TRANSACTION_RESUME_HASH" "$TRANSACTION_PEER" "$TRANSACTION_MESSAGE_ID" "$TRANSACTION_SEQUENCE"
  fi
}

recover_transaction_locked() {
  local room transaction
  room=$1
  transaction=$2
  read_transaction "$transaction"
  ensure_transaction_sequence_locked "$room"
  ensure_transaction_message_locked "$room" "$transaction"
  ensure_transaction_retirement_locked "$room"
  read_manifest "$room"
  if transaction_state_matches "$TRANSACTION_BEFORE_A_HASH" "$TRANSACTION_BEFORE_A_BOUNDARY" "$TRANSACTION_BEFORE_B_HASH" "$TRANSACTION_BEFORE_B_BOUNDARY"; then
    write_manifest_atomic "$room" "$TRANSACTION_AFTER_A_HASH" "$TRANSACTION_AFTER_A_BOUNDARY" "$TRANSACTION_AFTER_B_HASH" "$TRANSACTION_AFTER_B_BOUNDARY"
  elif transaction_state_matches "$TRANSACTION_AFTER_A_HASH" "$TRANSACTION_AFTER_A_BOUNDARY" "$TRANSACTION_AFTER_B_HASH" "$TRANSACTION_AFTER_B_BOUNDARY"; then
    :
  fi
}

recover_transactions_locked() {
  local room transaction
  room=$1
  for transaction in "$room"/transactions/*; do
    [ -e "$transaction" ] || continue
    recover_transaction_locked "$room" "$transaction"
  done
}

commit_membership_transaction_locked() {
  local room event peer target resume_hash before_a_hash before_a_boundary before_b_hash before_b_boundary after_a_hash after_a_boundary after_b_hash after_b_boundary
  room=$1
  event=$2
  peer=$3
  target=$4
  resume_hash=$5
  before_a_hash=$6
  before_a_boundary=$7
  before_b_hash=$8
  before_b_boundary=$9
  shift 9
  after_a_hash=$1
  after_a_boundary=$2
  after_b_hash=$3
  after_b_boundary=$4

  reserve_sequence_locked "$room"
  if [ "$event" = left ]; then
    if [ "$peer" = peer-a ]; then after_a_boundary=$PUBLISHED_SEQUENCE; else after_b_boundary=$PUBLISHED_SEQUENCE; fi
  fi
  TRANSACTION_STAGING=$(mktemp -d "$room/.transaction.XXXXXX") || fail write-failed 'transaction staging directory'
  {
    printf 'TRANSACTION_VERSION=1\n'
    printf 'EVENT=%s\n' "$event"
    printf 'PEER=%s\n' "$peer"
    printf 'TARGET=%s\n' "$target"
    printf 'RESUME_HASH=%s\n' "$resume_hash"
    printf 'MESSAGE_ID=%s\n' "$PUBLISHED_ID"
    printf 'SEQUENCE=%s\n' "$PUBLISHED_SEQUENCE"
    printf 'BEFORE_A_HASH=%s\n' "$before_a_hash"
    printf 'BEFORE_A_BOUNDARY=%s\n' "$before_a_boundary"
    printf 'BEFORE_B_HASH=%s\n' "$before_b_hash"
    printf 'BEFORE_B_BOUNDARY=%s\n' "$before_b_boundary"
    printf 'AFTER_A_HASH=%s\n' "$after_a_hash"
    printf 'AFTER_A_BOUNDARY=%s\n' "$after_a_boundary"
    printf 'AFTER_B_HASH=%s\n' "$after_b_hash"
    printf 'AFTER_B_BOUNDARY=%s\n' "$after_b_boundary"
  } > "$TRANSACTION_STAGING/record"
  {
    printf '%s\n' '---'
    printf 'message-type: system\n'
    printf 'event: %s\n' "$event"
    printf 'peer: %s\n' "$peer"
    printf '%s\n' '---'
    printf '\n# Peer %s\n\n`%s` %s the Chat room.\n' "$event" "$peer" "$event"
  } > "$TRANSACTION_STAGING/message.md"
  chmod 600 "$TRANSACTION_STAGING/record" "$TRANSACTION_STAGING/message.md"
  mv -- "$TRANSACTION_STAGING" "$room/transactions/$PUBLISHED_ID"
  TRANSACTION_STAGING=
  recover_transaction_locked "$room" "$room/transactions/$PUBLISHED_ID"
}

leave_room() {
  local room_id resume_id room resume_hash peer target current_hash current_boundary
  room_id=
  resume_id=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      *) fail invalid-arguments "unknown leave argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] || fail invalid-arguments 'leave needs --room and --resume'
  room=$(require_room "$room_id")
  resume_hash=$(printf '%s' "$resume_id" | sha256)
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  read_manifest "$room"

  if [ -f "$room/retired/$resume_hash" ] && [ ! -L "$room/retired/$resume_hash" ]; then
    read_retirement "$room/retired/$resume_hash"
    if [ "$RETIRED_PEER" = peer-a ]; then
      current_hash=$PEER_A_HASH
      current_boundary=$PEER_A_BOUNDARY
    else
      current_hash=$PEER_B_HASH
      current_boundary=$PEER_B_BOUNDARY
    fi
    if [ -z "$current_hash" ] && [ "$current_boundary" = "$RETIRED_BOUNDARY" ]; then
      release_lock
      printf 'EVENT=left\n'
      printf 'ROOM_ID=%s\n' "$room_id"
      printf 'PEER=%s\n' "$RETIRED_PEER"
      printf 'MESSAGE_ID=%s\n' "$RETIRED_MESSAGE_ID"
      printf 'IDEMPOTENT=true\n'
      return 0
    fi
    fail peer-replaced 'retired Resume ID cannot affect the replacement Peer'
  fi

  if [ "$resume_hash" = "$PEER_A_HASH" ] && [ -n "$PEER_A_HASH" ]; then
    peer=peer-a
  elif [ "$resume_hash" = "$PEER_B_HASH" ] && [ -n "$PEER_B_HASH" ]; then
    peer=peer-b
  else
    fail invalid-resume-id 'credential did not match this room'
  fi

  collect_unread "$room" "$peer"
  if [ "${#UNREAD_IDS[@]}" -gt 0 ]; then
    release_lock
    printf 'EVENT=messages\n'
    printf 'OPERATION=leave\n'
    printf 'ROOM_ID=%s\n' "$room_id"
    printf 'PEER=%s\n' "$peer"
    print_collected_unread
    return 0
  fi

  read_manifest "$room"
  if [ "$peer" = peer-a ]; then
    if [ -n "$PEER_B_HASH" ]; then target=peer-b; else target=none; fi
  else
    if [ -n "$PEER_A_HASH" ]; then target=peer-a; else target=none; fi
  fi
  if [ "$peer" = peer-a ]; then
    commit_membership_transaction_locked "$room" left "$peer" "$target" "$resume_hash" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY" \
      '' "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY"
  else
    commit_membership_transaction_locked "$room" left "$peer" "$target" "$resume_hash" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY" \
      "$PEER_A_HASH" "$PEER_A_BOUNDARY" '' "$PEER_B_BOUNDARY"
  fi
  release_lock

  printf 'EVENT=left\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=%s\n' "$peer"
  printf 'MESSAGE_ID=%s\n' "$PUBLISHED_ID"
  printf 'IDEMPOTENT=false\n'
}

resume_room() {
  local room_id resume_id room peer
  room_id=
  resume_id=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      *) fail invalid-arguments "unknown resume argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] || fail invalid-arguments 'resume needs --room and --resume'
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  peer=$(identify_peer "$room" "$resume_id")
  collect_unread "$room" "$peer"
  release_lock
  printf 'EVENT=resumed\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=%s\n' "$peer"
  print_collected_unread
}

send_message() {
  local room_id resume_id source room peer
  room_id=
  resume_id=
  source=-
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      --file) [ "$#" -ge 2 ] || fail invalid-arguments '--file needs a value'; source=$2; shift 2 ;;
      *) fail invalid-arguments "unknown send argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] || fail invalid-arguments 'send needs --room and --resume'
  [ "$source" = '-' ] || [ -f "$source" ] || fail message-file-missing "$source"
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  peer=$(identify_peer "$room" "$resume_id")
  publish_message_locked "$room" "$peer" "$source"
  release_lock
  printf 'EVENT=sent\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'MESSAGE_ID=%s\n' "$PUBLISHED_ID"
}

validate_interval() {
  local interval
  interval=$1
  printf '%s\n' "$interval" | grep -Eq '^[0-9]+([.][0-9]+)?$' || return 1
  awk -v value="$interval" 'BEGIN { exit !(value > 0) }'
}

watch_loop() {
  local room_id resume_id interval room peer resume_hash
  room_id=$1
  resume_id=$2
  interval=$3
  validate_interval "$interval" || fail invalid-interval "$interval"
  resume_hash=$(printf '%s' "$resume_id" | sha256)
  while :; do
    room=$(require_room "$room_id")
    acquire_lock "$room/locks/room.lock"
    recover_transactions_locked "$room"
    if [ -f "$room/retired/$resume_hash" ] && [ ! -L "$room/retired/$resume_hash" ]; then
      read_retirement "$room/retired/$resume_hash"
      release_lock
      printf 'EVENT=left\n'
      printf 'ROOM_ID=%s\n' "$room_id"
      printf 'PEER=%s\n' "$RETIRED_PEER"
      printf 'MESSAGE_ID=%s\n' "$RETIRED_MESSAGE_ID"
      return 0
    fi
    peer=$(identify_peer "$room" "$resume_id")
    collect_unread "$room" "$peer"
    release_lock
    if [ "${#UNREAD_IDS[@]}" -gt 0 ]; then
      printf 'EVENT=messages\n'
      printf 'ROOM_ID=%s\n' "$room_id"
      printf 'PEER=%s\n' "$peer"
      print_collected_unread
      return 0
    fi
    sleep "$interval"
  done
}

watch_room() {
  local room_id resume_id interval
  room_id=
  resume_id=
  interval=10
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      --interval) [ "$#" -ge 2 ] || fail invalid-arguments '--interval needs a value'; interval=$2; shift 2 ;;
      *) fail invalid-arguments "unknown watch argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] || fail invalid-arguments 'watch needs --room and --resume'
  watch_loop "$room_id" "$resume_id" "$interval"
}

acknowledge_messages() {
  local room peer message_id message_path candidate match_count ack_dir ack_tmp
  room=$1
  peer=$2
  shift 2
  case $peer in peer-a|peer-b) ;; *) fail corrupt-room "unknown peer: $peer" ;; esac

  for message_id in "$@"; do
    validate_message_id "$message_id" || fail invalid-message-id "$message_id"
    message_path=
    match_count=0
    for candidate in "$room/messages/${message_id}-"*.md; do
      [ -f "$candidate" ] && [ ! -L "$candidate" ] || continue
      message_path=$candidate
      match_count=$((match_count + 1))
    done
    [ "$match_count" -eq 1 ] || fail invalid-message-id "$message_id is not an incoming message"
    parse_message_path "$message_path"
    [ "$MESSAGE_TARGET" = "$peer" ] || fail invalid-message-id "$message_id is not an incoming message"
  done

  ack_dir="$room/acknowledgments/$peer"
  for message_id in "$@"; do
    [ ! -e "$ack_dir/$message_id" ] || continue
    ack_tmp=$(mktemp "$ack_dir/.ack.XXXXXX") || fail write-failed 'acknowledgment temporary file'
    chmod 600 "$ack_tmp"
    mv -- "$ack_tmp" "$ack_dir/$message_id"
  done
}

ack_and_watch() {
  local room_id resume_id interval room peer
  local -a ack_ids
  room_id=
  resume_id=
  interval=10
  ack_ids=()
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      --ack) [ "$#" -ge 2 ] || fail invalid-arguments '--ack needs a value'; ack_ids[${#ack_ids[@]}]=$2; shift 2 ;;
      --interval) [ "$#" -ge 2 ] || fail invalid-arguments '--interval needs a value'; interval=$2; shift 2 ;;
      *) fail invalid-arguments "unknown ack-and-watch argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] && [ "${#ack_ids[@]}" -gt 0 ] || fail invalid-arguments 'ack-and-watch needs --room, --resume, and at least one --ack'
  validate_interval "$interval" || fail invalid-interval "$interval"
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  peer=$(identify_peer "$room" "$resume_id")
  acknowledge_messages "$room" "$peer" "${ack_ids[@]}"
  release_lock
  watch_loop "$room_id" "$resume_id" "$interval"
}

rotate_resume_id() {
  local room_id resume_id target room caller replacement replacement_hash manifest_tmp
  room_id=
  resume_id=
  target=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      --peer) [ "$#" -ge 2 ] || fail invalid-arguments '--peer needs a value'; target=$2; shift 2 ;;
      *) fail invalid-arguments "unknown rotate argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] && [ -n "$target" ] || fail invalid-arguments 'rotate needs --room, --resume, and --peer'
  case $target in peer-a|peer-b) ;; *) fail invalid-arguments "invalid peer: $target" ;; esac
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  caller=$(identify_peer "$room" "$resume_id")
  [ "$caller" != "$target" ] || fail invalid-rotation-target 'a Peer can rotate only the other Peer'
  read_manifest "$room"
  if [ "$target" = peer-b ]; then
    [ -n "$PEER_B_HASH" ] || fail invalid-rotation-target 'peer-b has not joined'
  fi

  replacement=$(random_hex 32)
  replacement_hash=$(printf '%s' "$replacement" | sha256)
  manifest_tmp=$(mktemp "$room/.manifest.XXXXXX") || fail write-failed 'manifest temporary file'
  if [ "$target" = peer-a ]; then
    [ -n "$PEER_A_HASH" ] || fail invalid-rotation-target 'peer-a is open'
    write_manifest "$manifest_tmp" "$replacement_hash" "$PEER_A_BOUNDARY" "$PEER_B_HASH" "$PEER_B_BOUNDARY"
  else
    write_manifest "$manifest_tmp" "$PEER_A_HASH" "$PEER_A_BOUNDARY" "$replacement_hash" "$PEER_B_BOUNDARY"
  fi
  mv -- "$manifest_tmp" "$room/manifest"
  release_lock

  printf 'EVENT=rotated\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=%s\n' "$target"
  printf 'RESUME_ID=%s\n' "$replacement"
}

list_rooms() {
  local path room_id
  local -a room_ids
  [ "$#" -eq 0 ] || fail invalid-arguments 'list takes no arguments'
  room_ids=()
  if [ -L "$ROOT" ]; then
    fail unsafe-root "$ROOT is a symbolic link"
  fi
  if [ -e "$ROOT" ] && [ ! -d "$ROOT" ]; then
    fail unsafe-root "$ROOT is not a directory"
  fi
  if [ -d "$ROOT" ]; then
    for path in "$ROOT"/*; do
      [ -d "$path" ] && [ ! -L "$path" ] || continue
      room_id=${path##*/}
      validate_room_id "$room_id" || continue
      room_ids[${#room_ids[@]}]=$room_id
    done
  fi
  printf 'EVENT=rooms\n'
  printf 'ROOM_COUNT=%s\n' "${#room_ids[@]}"
  if [ "${#room_ids[@]}" -gt 0 ]; then
    printf 'ROOM_ID=%s\n' "${room_ids[@]}" | LC_ALL=C sort
  fi
}

room_status() {
  local room_id resume_id room peer peer_a_state peer_b_state unread_count
  room_id=
  resume_id=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      *) fail invalid-arguments "unknown status argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] || fail invalid-arguments 'status needs --room'
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  read_manifest "$room"
  if [ -n "$PEER_A_HASH" ]; then peer_a_state=assigned; else peer_a_state=open; fi
  if [ -n "$PEER_B_HASH" ]; then peer_b_state=assigned; else peer_b_state=open; fi
  if [ -n "$resume_id" ]; then
    peer=$(identify_peer "$room" "$resume_id")
    collect_unread "$room" "$peer"
    unread_count=${#UNREAD_IDS[@]}
  fi
  release_lock
  printf 'EVENT=status\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER_A=%s\n' "$peer_a_state"
  printf 'PEER_B=%s\n' "$peer_b_state"
  if [ -n "$resume_id" ]; then
    printf 'PEER=%s\n' "$peer"
    printf 'UNREAD_COUNT=%s\n' "$unread_count"
  fi
}

room_history() {
  local room_id resume_id room peer path index
  local -a history_ids history_types history_senders history_targets history_paths
  room_id=
  resume_id=
  while [ "$#" -gt 0 ]; do
    case $1 in
      --room) [ "$#" -ge 2 ] || fail invalid-arguments '--room needs a value'; room_id=$2; shift 2 ;;
      --resume) [ "$#" -ge 2 ] || fail invalid-arguments '--resume needs a value'; resume_id=$2; shift 2 ;;
      *) fail invalid-arguments "unknown history argument: $1" ;;
    esac
  done
  [ -n "$room_id" ] && [ -n "$resume_id" ] || fail invalid-arguments 'history needs --room and --resume'
  room=$(require_room "$room_id")
  acquire_lock "$room/locks/room.lock"
  recover_transactions_locked "$room"
  peer=$(identify_peer "$room" "$resume_id")
  history_ids=()
  history_types=()
  history_senders=()
  history_targets=()
  history_paths=()
  for path in "$room"/messages/*.md; do
    [ -f "$path" ] && [ ! -L "$path" ] || continue
    parse_message_path "$path"
    history_ids[${#history_ids[@]}]=$MESSAGE_ID
    history_types[${#history_types[@]}]=$MESSAGE_TYPE
    history_senders[${#history_senders[@]}]=$MESSAGE_SENDER
    history_targets[${#history_targets[@]}]=$MESSAGE_TARGET
    history_paths[${#history_paths[@]}]=$path
  done
  release_lock
  printf 'EVENT=history\n'
  printf 'ROOM_ID=%s\n' "$room_id"
  printf 'PEER=%s\n' "$peer"
  printf 'MESSAGE_COUNT=%s\n' "${#history_ids[@]}"
  index=0
  while [ "$index" -lt "${#history_ids[@]}" ]; do
    printf 'MESSAGE_ID=%s\n' "${history_ids[$index]}"
    printf 'MESSAGE_TYPE=%s\n' "${history_types[$index]}"
    printf 'MESSAGE_SENDER=%s\n' "${history_senders[$index]}"
    printf 'MESSAGE_TARGET=%s\n' "${history_targets[$index]}"
    printf 'MESSAGE_PATH=%s\n' "${history_paths[$index]}"
    index=$((index + 1))
  done
}

main() {
  [ "$#" -gt 0 ] || { usage >&2; exit 1; }
  case $1 in
    --help|-h|help) usage ;;
    create) shift; create_room "$@" ;;
    join) shift; join_room "$@" ;;
    leave) shift; leave_room "$@" ;;
    resume) shift; resume_room "$@" ;;
    send) shift; send_message "$@" ;;
    watch) shift; watch_room "$@" ;;
    ack-and-watch) shift; ack_and_watch "$@" ;;
    rotate) shift; rotate_resume_id "$@" ;;
    list) shift; list_rooms "$@" ;;
    status) shift; room_status "$@" ;;
    history) shift; room_history "$@" ;;
    *) fail invalid-command "$1" ;;
  esac
}

main "$@"
