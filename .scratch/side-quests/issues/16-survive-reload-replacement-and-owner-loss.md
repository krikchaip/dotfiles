# 16: Survive reload, replacement, and owner loss

Type: task

**Status:** ready-for-agent

**What to build:** Make every completed capability durable across normal reload and safe across parent replacement or loss. Reload adopts live children, widgets, layout, policy, requests, and terminal events without duplication. Every other parent teardown stops owned processes while retaining valid resumable sessions.

**Blocked by:** 13. Configure general-purpose and named agents; 14. Detect stalls and recoveries; 15. Apply deterministic and safe tmux layouts.

- [ ] Treat reload as a handoff: stop the old poller and UI without stopping children, then validate and adopt the same owner's records in the new instance.
- [ ] Rebuild delivered event IDs from the main session before reading pending requests or terminal state, so events written during reload are delivered exactly once.
- [ ] Restore the complete widget, navigation state, heartbeat polling, canonical pane tracking, and deterministic layout without stealing focus.
- [ ] Preserve each adopted or reopened child's immutable manifest policy even when parent settings or agent files changed.
- [ ] Renew an owner lease during polling and make children validate both unique process identity and lease freshness.
- [ ] On quit, new, resume, fork, clone, abrupt death, broken reload, or owner expiry, stop all owned child processes and managed panes without terminal handoffs or session deletion.
- [ ] Validate resume paths by real path, regular-file type, managed-root containment, path IDs, manifest IDs, schema version, and owner lineage; reject symlink escapes and foreign or malformed sessions.
- [ ] Keep session data and unanswered requests outside normal Pi session storage with owner-only permissions and atomic file replacement through races.
- [ ] Ensure sub-agent sessions never appear in normal `/resume` and survive completion, failure, cancellation, closure, shutdown, and reload.
- [ ] E2E-demo live reload, completion during reload, pending-request reload, policy continuity, layout restoration, event deduplication, every parent teardown reason, abrupt owner loss, expired lease, window deletion, no orphan process, and safe later resume.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
