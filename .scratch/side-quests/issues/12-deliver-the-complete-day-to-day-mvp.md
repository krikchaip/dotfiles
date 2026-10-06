# 12: Deliver the complete day-to-day MVP

Type: task

**Status:** done

**What to build:** Make Side Quests usable in daily work through one complete general-purpose delegation slice. The parent agent can launch concurrent Pi sub-agents asynchronously, monitor and control them through the complete parent and child UI, exchange correlated questions and continuations, use autonomous or interactive lifecycles, and receive truthful terminal results. Each sub-agent performs a complete side quest. Persist each child as a resumable managed Pi session and preserve parent-pane focus throughout.

**Blocked by:** 11. Establish package architecture and verification loop.

- [x] Register exactly one public `Agent` tool with the specified strict request schema, reserved `general-purpose` choice, asynchronous acknowledgements, and canonical session paths.
- [x] Launch only Pi, directly in detached panes of one shared sub-agent window, from the parent agent's invocation-time working directory without an intermediate shell or focus change.
- [x] Insert each created or replacement shared window directly after the parent Pi process's current tmux window. Keep separate windows for parents sharing one tmux window, leave later user moves unchanged, and use normal placement only if the parent target disappears.
- [x] Support concurrent new launches, live-idle continuation, live-active steering after the current tool batch, stopped-session reopen, and duplicate-process prevention.
- [x] Clone the parent runtime for the standard general-purpose child, copy context once by default, preserve a fresh-context option, hard-deny every spawning tool, and force-enable `ask_parent`.
- [x] Persist the session, resolved manifest, owner state, activity state, terminal state, and request/response mailboxes under the managed Side Quests storage root.
- [x] Support autonomous and initially interactive lifecycles, permanent promotion only through accepted direct terminal input after creation, no demotion, and no promotion from resume, incidental input, or programmatic input.
- [x] Use `subagent_done({ result })` as the only successful completion declaration for autonomous children. Remove it and all prompt metadata on promotion. Keep no-argument `/subagent-done` available in both lifecycles to start one hidden completion-only turn. Render the persisted tool call as the single `WRAP UP` banner.
- [x] Make `ask_parent` accept one correlated request, return without terminating the child turn, preserve sibling tool execution, reject a second pending request, wake the parent, and accept its matching answer only through `Agent.resume`.
- [x] Render the complete restrained parent widget and child identity widget with elapsed time, identity, task, lifecycle/activity, reply state, exact padding and column alignment, task-first narrow-width truncation, and semantic colors from Pi's active theme.
- [x] Implement `Shift+Up` and `/side-quests` parent navigation with effective Pi selection bindings, stable child identity, explicit pane jump, scoped delete key hint, named confirmation, cancellation semantics, and no parent interrupt action. After confirmed deletion, keep navigation focused on the nearest survivor; close it only when no children remain. In a child, make `Shift+Up` focus the canonical parent pane.
- [x] Render collapsed and expanded parent results with effective `app.tools.expand` hints and clear completed, failed, cancelled, and closed outcomes.
- [x] Include the explicit `subagent_done.result` for success, current-run assistant output only as valid failure or closure diagnostics, the canonical session path, pending-request state where relevant, and no full transcript or stale-response substitution.
- [x] Keep interactive provider or agent-loop turn failures local while treating autonomous exhausted failures and fatal process exits as terminal according to the README.
- [x] Preserve unmanaged panes and use a safe basic tmux arrangement until the deterministic layout ticket replaces geometry policy.
- [x] E2E-demo explicit autonomous and command-driven completion, completion-tool removal on promotion, live and persisted tool-owned `WRAP UP` banners, failed command-turn recovery, terminal takeover, parent questions, continuation, reopen, `Shift+Up` and command navigation, closure outcomes, narrow widgets, focus, retained sessions, and shared-window insertion beside the parent while preserving existing windows.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
