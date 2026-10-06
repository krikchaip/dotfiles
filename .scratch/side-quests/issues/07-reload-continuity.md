# Reload Continuity

Type: decision
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model): parent agent and sub-agent name actors; main quest and side quest name tasks.

## Question

How do active sub-agents, result delivery, and the parent widget behave across Pi `/reload`?

## Answer

Treat `/reload` as an extension-runtime handoff, not as parent shutdown. In `session_shutdown` with reason `reload`, stop the old poller and remove its UI, but do not terminate child processes or panes. For `quit`, `new`, `resume`, and `fork`, retain the existing rule: terminate this parent agent session's children, close managed panes, and retain child sessions.

Persist `owner.json`, canonical pane IDs, child session paths, and child snapshot paths under the runtime root. On `session_start` with reason `reload`, the new extension instance validates and adopts records owned by the same full parent-session UUID and unique parent process identity, then reinstalls one-second polling, the widget, tmux monitoring, and navigation. Agent-definition changes apply only to future launches; adopted and reopened children keep their manifest policy.

Every child event that can reach the parent has a stable event ID. Parent custom messages for completion, failure, closure, and `ask_parent` include that ID. On reload, rebuild the delivered-ID set from the main session entries before processing snapshots and terminal sidecars. This gives durable, idempotent delivery: an event written during the reload gap is delivered once, while an already-persisted event is not repeated.

The parent renews an owner lease as part of its poll cycle. Children validate both the unique owner process identity and this lease. A normal reload adopts and renews the lease before its grace period expires. If reload removes or breaks the extension, children terminate after the lease grace period even though the parent process still exists. Their session files remain resumable.

Recompute the widget and full pane layout after adoption. Keep parent-pane focus unchanged. If one child finishes during reload, process its terminal sidecar before rendering the first post-reload widget.