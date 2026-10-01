# Sub-Agent Session Storage

Type: decision
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model): parent agent and sub-agent name actors; main quest and side quest name tasks.

## Question

What folder structure, ownership rules, and retention policy keep sub-agent sessions resumable without adding them to Pi's normal `/resume` list?

## Answer

Use `$PI_CODING_AGENT_DIR/side-quests/` (default `~/.pi/agent/side-quests/`) as the only storage root:

```text
side-quests/
  sessions/<parent-session-uuid>/<child-session-uuid>/
    session.jsonl
    manifest.json
    mailbox/
      request.json
      response.json
  runtime/<parent-session-uuid>/
    owner.json
    children/<child-session-uuid>/
      activity.json
      terminal.json
  resources/snapshot-<uuid>/
  snapshot-objects/v3/
  snapshot-index/v3/
  snapshot-aliases/v3/
  snapshot-leases/v3/
```

The canonical `Agent.resume` identifier is the absolute path to `session.jsonl`. The visible tmux title is presentation-only and follows the selected-pane ownership policy; all files and ownership checks use full UUIDs. A manifest stores child identity and the resolved launch policy needed to reopen it: canonical agent name, display label, task label, CWD, model, thinking level, exact tool allowlist, skill/system-prompt snapshot, context-inheritance choice, lifecycle mode, and parent lineage when a parent session file exists. Resume can update only the task label; it cannot change identity, context choice, lifecycle, capabilities, or prompt policy. A human terminal takeover can permanently promote lifecycle. Later definition or parent-setting changes affect new children only.

Only accept resume paths that resolve to regular `session.jsonl` files under this managed root and whose manifest IDs and path segments agree. Reject missing, malformed, symlink-escaped, or foreign paths. Create directories with owner-only access and write JSON files atomically by rename.

Keep session files, manifests, and unanswered mailbox requests until explicit user deletion. Do not add automatic age deletion in the MVP. Remove a response after the child acknowledges it. Runtime snapshots are replaceable state: remove them after terminal handling, and remove stale runtime trees only after their recorded owner process identity and lease are both dead. Never delete retained session data during parent shutdown, pane closure, cancellation, reload, or stale-runtime cleanup.

Remote Package storage is separate from retained session data. Store each immutable file by content identity and hard-link it into read-only native-resolution graph views. Reuse unchanged content across sessions, processes, source timestamps, installed paths, and Package versions. Never link mutable installed bytes into the store. Use no default fixed byte cap; reserve only distinct new content and metadata, retain the 2 GiB post-allocation free-space floor, and allow an explicit positive safe-integer operator/test cap.

A v3 graph is collectible only after its publication grace period when no live process lease and no managed saved manifest references it. Invalid ownership metadata blocks deletion. Legacy resources without v3 ownership proof remain untouched. This resource cleanup does not delete session files or manifests.

This root remains outside Pi's normal session tree, so sub-agent sessions do not appear in `/resume`. Resuming is only through `Agent.resume` with the canonical path returned in the parent conversation.