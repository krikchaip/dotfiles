# `scripts/chat-room.sh`

## Portability

The script runs through Bash on macOS and Linux, including macOS Bash 3.2. It uses standard utilities, `mktemp`, atomic `mkdir`, and atomic same-filesystem `mv`. It does not require `flock`, Node.js, Python, or a harness adapter.

Chat rooms live under `${TMPDIR:-/tmp}/agent-chat-rooms`. The root and room data use permissions that deny access to other operating-system users.

The room protocol stays at version 1. Any other manifest version is corrupt input. The protocol version does not increment and has no migration path.

## Room layout

```text
<root>/<room-id>/
├── manifest
├── sequence
├── messages/
│   ├── 00000000000000000001-system-to-none.md
│   ├── 00000000000000000002-peer-a.md
│   └── 00000000000000000003-system-to-peer-a.md
├── acknowledgments/
│   ├── peer-a/
│   └── peer-b/
├── retired/
│   └── <resume-id-hash>
├── transactions/
│   └── <membership-message-id>/
│       ├── record
│       └── message.md
└── locks/
```

`sequence` is the durable allocation high-water mark. A reserved sequence can remain unused after an interruption, but no later message reuses it.

`manifest` is the materialized membership view. It records the protocol version, the current Resume ID hash for each assigned slot, and the delivery boundary for each slot. An empty hash means that slot is open. A boundary is the sequence number of the most recent committed leave from that slot.

A replacement receives messages targeted to its slot only when their sequence number is later than the slot boundary. This rule includes Peer messages sent while the slot was open. It excludes the former Peer's Inbox.

`transactions/` is the authoritative persistent log of committed join and leave operations. Each internal record contains the before and after membership views, the Resume ID hash, the System event metadata, the reserved sequence, and the exact System message content. It contains no raw Resume ID. An atomic rename of a complete transaction directory into `transactions/` is the membership commit point.

A transaction record is internal recovery data. It is not a user-visible or persistent `leaving` membership state. Membership remains assigned or open.

`retired/` is a derived hash-keyed view of committed leave transactions. A record identifies the slot, leave message, and leave boundary. It supports idempotent leave and lets an old watcher exit cleanly. It does not authorize resume, send, acknowledgment, inspection, or mutation of a replacement.

## Message records

Every Peer or System message is one immutable Markdown file. Its 20-digit prefix is the global room sequence and Message ID.

Peer message names end in `peer-a.md` or `peer-b.md`. Their author is that Peer and their target is the other slot.

System message names end in one of these values:

- `system-to-peer-a.md`
- `system-to-peer-b.md`
- `system-to-none.md`

System message content has YAML frontmatter with `message-type: system`, the membership `event`, and the affected `peer`. Supported membership events are `joined` and `left`.

Creation records a `joined` event for `peer-a` with no target. Every later successful join or leave also records one ordered System message. A membership event targets the counterpart only when that counterpart is assigned at event time. The joining or leaving Peer does not receive its own event.

An Acknowledgment is an empty file named for the consumed Message ID under the receiving Peer. Acknowledgment accepts either a Peer message or a System message targeted to that Peer.

## Atomic operations and recovery

A short room lock protects sequence allocation, transaction commit and recovery, Resume ID rotation, send authentication and publication, and acknowledgment authentication and publication. An operation that authenticates a mutating request does so while it holds this lock.

Room creation writes the complete initial room in a hidden staging directory. The final room-directory rename atomically commits creation with its first System message.

Join and leave use this order:

1. Recover all earlier committed membership transactions.
2. Reserve and persist the next sequence number.
3. Write the complete transaction in a hidden staging directory.
4. Atomically rename that directory into `transactions/` to commit it.
5. Recover the derived System message, retirement record when applicable, and manifest view.
6. Return the successful command result only after all derived files exist.

An interruption before step 4 commits no membership change. It can leave an unused reserved sequence or hidden staging data. An interruption after step 4 leaves a committed transaction that the next room-specific public command completes.

Recovery is idempotent. It restores a lowered sequence high-water mark, publishes a missing System message at its reserved ID, recreates a missing retirement record, and applies the after-membership view when the manifest still matches the recorded before-view. It validates an existing derived file instead of publishing a duplicate. Persistent transactions can also repair a derived file that is lost after normal completion.

A Peer message source is consumed while the room lock is held. Standard input writes directly into one hidden room-owned message file. `--file` copies the selected file once into that same hidden message file and leaves the source unchanged. After validation, sequence allocation and atomic rename publish the message. Accepted input bytes stay unchanged, and the script sets no message-size limit.

Manifest and acknowledgment updates also use same-filesystem temporary files and atomic rename. Stale locks record their process ID and can be recovered when that local process no longer exists.

Resume ID rotation changes only the manifest. Its atomic manifest rename is its single state commit, so it has no derived credential state to recover. Room creation is atomic at the room-directory rename. The fixed version-1 protocol has no migration path.

Generated Room IDs use a human-readable name plus a random suffix. Custom IDs must match the bounded safe-name rule, must not be `.` or `..`, and must not already exist. Resume IDs use 32 random bytes and are stored only as SHA-256 hashes.

## Subcommands

```text
chat-room.sh create [--room <room-id>] [--file <path>]
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
```

`send` reads one Peer message from standard input when `--file` is absent. `create` reads an optional initial Peer message the same way; zero-byte standard input means no initial message. For either command, `--file` selects that file and leaves standard input unread. Empty and whitespace-only selected messages fail with `ERROR=empty-message`. Whitespace is the POSIX character class under the C locale. Direct positional message content and a `--message` option are invalid arguments.

Natural-language argument inference belongs to `SKILL.md`. This script interface stays strict.

For `join`, `--peer` is a preference, not a required slot. Join selects the preferred slot when it is open. Otherwise, it selects the other open slot. Without a preference, it selects `peer-a` first and then `peer-b`. Join fails only when both slots are assigned.

## Create and join results

`create` atomically creates a room, assigns `peer-a`, records its System join event, optionally sends the first Peer message, and prints:

```text
EVENT=created
ROOM_ID=<room-id>
PEER=peer-a
RESUME_ID=<resume-id>
MESSAGE_ID=<initial-peer-message-id-or-empty>
SYSTEM_MESSAGE_ID=<join-system-message-id>
```

`join` commits one persistent membership transaction. Recovery claims the open slot and publishes its System join event before the command prints:

```text
EVENT=joined
ROOM_ID=<room-id>
PEER=<claimed-peer>
RESUME_ID=<resume-id>
MESSAGE_ID=
SYSTEM_MESSAGE_ID=<join-system-message-id>
MESSAGE_COUNT=<count>
MESSAGE_ID=<unread-message-id>
MESSAGE_PATH=<absolute-path>
```

The unread records follow the common receive format. They include only messages after the claimed slot's current delivery boundary.

## Leave results

`leave` authenticates and checks the selected Peer's Inbox while it holds the room lock.

When unread messages exist, leave changes no membership, message, boundary, credential, or Acknowledgment. It exits successfully with:

```text
EVENT=messages
OPERATION=leave
ROOM_ID=<room-id>
PEER=<current-peer>
MESSAGE_COUNT=<count>
MESSAGE_ID=<message-id>
MESSAGE_PATH=<absolute-path>
```

The caller processes and acknowledges the complete batch before retrying leave.

When the Inbox is empty, leave commits one persistent membership transaction. Recovery records the ordered System leave message, retires the Resume ID, sets the slot boundary to that leave sequence, and opens the slot. It prints:

```text
EVENT=left
ROOM_ID=<room-id>
PEER=<retired-peer>
MESSAGE_ID=<leave-system-message-id>
IDEMPOTENT=false
```

Repeating leave with the retired Resume ID returns the same result with the same Message ID and `IDEMPOTENT=true` while that slot stays open at the same boundary. It creates no second System message.

After a replacement claims the slot, the old Resume ID cannot affect it. Repeated leave fails with `ERROR=peer-replaced`. The old ID stays invalid for resume and send.

Either slot can leave. Both slots can be open. The room remains joinable until temporary storage is removed by the operating system.

## Send, resume, and rotate results

`resume` validates the current Room ID and Resume ID. It prints `EVENT=resumed`, the selected Peer, and that Peer's unread records.

`send` authenticates and publishes under the same room lock. It prints `EVENT=sent`, Room ID, and Message ID. A concurrent successful leave prevents a stale send from publishing after retirement.

`rotate` validates that the caller is the opposite current Peer and that the target slot is assigned. It replaces the target Resume ID hash and prints `EVENT=rotated`, Room ID, target Peer, and replacement Resume ID. The skill uses it only after explicit local-user approval.

## Receive results

`watch` checks for a retirement record and current unread messages before sleeping. When messages exist, it prints one batch and exits successfully:

```text
EVENT=messages
ROOM_ID=<room-id>
PEER=<receiving-peer>
MESSAGE_COUNT=<count>
MESSAGE_ID=<message-id>
MESSAGE_PATH=<absolute-path>
```

Records are in global message order. When the supplied Resume ID has retired, watch exits successfully instead:

```text
EVENT=left
ROOM_ID=<room-id>
PEER=<retired-peer>
MESSAGE_ID=<leave-system-message-id>
```

`ack-and-watch` validates and records every supplied Acknowledgment under the room lock, then behaves exactly like `watch`.

The script prints message paths rather than message bodies. The receiving model reads each immutable file through its harness. This keeps message boundaries exact and prevents shell-output truncation.

## Inspection

`list` prints every live Room ID under the temporary root.

`status` prints each slot as `assigned` or `open`. With a valid current Resume ID, it also prints that Peer's unread count.

`history` prints all Message IDs, types, senders, targets, and paths in global order. System events use `MESSAGE_TYPE=system` and `MESSAGE_SENDER=system`. Peer content uses `MESSAGE_TYPE=peer` and its Peer author.

Inspection can recover committed internal transactions before it reports state. It does not change Acknowledgments or the Harness session's Active and detached room context.

## Failures

Failures write a stable reason and detail to standard error and exit nonzero. Distinct reasons include:

- room missing, already exists, or full
- invalid or retired Resume ID
- retired Peer replaced
- invalid room name, interval, message ID, arguments, or empty message
- corrupt protocol data or unrecoverable lock

A failure before membership transaction commit leaves membership unchanged. After commit, recovery completes the committed membership change without duplicate System messages, credential resurrection, delivery-boundary loss, or sequence reuse. Other failed operations leave published messages, credentials, boundaries, and Acknowledgments unchanged.
