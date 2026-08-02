# Side-Quest Session Storage

Type: decision
Status: resolved

## Question

What folder structure, ownership rules, and retention policy keep side-quest sessions resumable without adding them to Pi's normal `/resume` list?

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
```

The canonical `Agent.resume` identifier is the absolute path to `session.jsonl`. The visible tmux name can use the parent's short UUID, but all files and ownership checks use full UUIDs. A manifest stores immutable child identity and the resolved launch policy needed to reopen it: canonical agent name, display label, task label, CWD, model, thinking level, exact tool allowlist, skill/system-prompt snapshot, context-inheritance choice, lifecycle mode, and parent lineage when a parent session file exists. Later definition or parent-setting changes affect new children only.

Only accept resume paths that resolve to regular `session.jsonl` files under this managed root and whose manifest IDs and path segments agree. Reject missing, malformed, symlink-escaped, or foreign paths. Create directories with owner-only access and write JSON files atomically by rename.

Keep session files, manifests, and unanswered mailbox requests until explicit user deletion. Do not add automatic age deletion in the MVP. Remove a response after the child acknowledges it. Runtime snapshots are replaceable state: remove them after terminal handling, and remove stale runtime trees only after their recorded owner process identity and lease are both dead. Never delete retained session data during parent shutdown, pane closure, cancellation, reload, or stale-runtime cleanup.

This root remains outside Pi's normal session tree, so side quests do not appear in `/resume`. Resuming is only through `Agent.resume` with the canonical path returned in the parent conversation.