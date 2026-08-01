# Side Quests

Label: wayfinder:map

## Destination

An implementation-ready specification for the tmux-only Pi `side-quests` extension, with a narrow Claude Code-style `Agent` naming surface and a deliberately reduced `pi-interactive-subagents` runtime.

## Notes

- Planning only. Do not implement extension changes while resolving this map.
- Explain behavior and product decisions first. Defer implementation details to each mapped ticket.
- Audit `hazat/pi-interactive-subagents` top-down, following its README section order and checking source where needed. Its behavior is the default baseline: retain features unless this map explicitly simplifies, replaces, or excludes them.
- Consult `tintinweb/pi-subagents` only for targeted compatibility choices or ideas that arise during the HazAT audit; it is not a co-equal runtime baseline.
- Earlier tool-interface and pane-layout decisions remain the baseline but may be revisited explicitly during the audit.
- Base the above-editor subagent status UI on `pi-interactive-subagents`' restrained widget style. Do not adopt `pi-subagents`' denser FleetView or above-editor agent panel; future UI features may extend the minimal baseline.
- Launch Pi child sessions only.
- Use `tintinweb/pi-subagents` as the compatibility reference for `Agent`, `subagent_type`, and related Claude Code-style conventions.
- Keep the tool name `Agent`.
- Name the extension `side-quests`.
- Support tmux only. Outside tmux, warn once at extension startup, register no tools or other extension functions, and remain inert.
- The model may use its judgment to launch a side quest when useful. Delegation is optional, not restricted to explicit user requests, and never forced on every task.
- Delegate coherent objectives with clear purpose and a return contract, not granular helper work the main quest can perform directly. Retrieval-only work never qualifies regardless of file count; search may support a side quest but cannot be its final objective. The main quest owns review and acceptance of returned evidence or changes.
- Give each parent Pi session one shared sub-agent tmux window. Create it on first spawn and reuse it for that session. Remove it after the final managed pane closes only when no unmanaged panes remain; never kill a user-created pane merely to remove the window.
- Name the shared tmux window with the first segment of the parent Pi session UUID. Use the full session ID for ownership and the canonical tmux window ID for targeting; the short window name is display-only.
- Treat the parent session as the main quest and each persistent child session as a side quest. MVP `Agent` launches side quests asynchronously so the main quest never waits. Omit `run_in_background`; synchronous child-process waiting remains a future backlog option.
- Every child Pi pane can accept terminal input. `interactive` controls lifecycle only: autonomous panes close after `agent_end`, while persistent panes stay open until explicitly finished. Only submitting a non-command prompt from the child terminal permanently changes an autonomous pane to persistent mode; editing, typing, pasting, navigation, and extension-injected messages do not.
- Do not expose a model-callable completion tool. Register child-only `/subagent-done` in every child so users can explicitly complete persistent or taken-over work; while an agent turn is active it refuses with a warning notification, and while idle it writes the trusted completion marker and shuts down.
- Reapply the intended pane layout when agents start or stop instead of relying only on tmux reflow.
- Support locked `binary` and `ternary` pane-layout modes through one arity-based algorithm; canonical landscape and portrait geometry lives in `prototypes/pane_layout_prototype.py`.
- Final specification must clearly separate features removed, excluded, or simplified from `pi-interactive-subagents` from features added by this extension.
- Store child sessions under `$PI_CODING_AGENT_DIR/side-quests/sessions/<parent-session-uuid>/<child-session-uuid>/`, outside Pi's normal session tree. Retain session data until explicit deletion; runtime files are replaceable state.
- Discover named agents only from project `.pi/agents/` and global `$PI_CODING_AGENT_DIR/agents/`; project wins name collisions. Do not scan `.agents/agents/` or ship bundled agents. An omitted `subagent_type` means general-purpose use and clones the parent's current runtime configuration; there is no explicit `"default"` enum value. `inherit_context` defaults true and may be set false for fresh, parent-unbiased work.
- Never expose `Agent` or any other subagent-spawning tool inside a subagent, regardless of inherited or requested permissions.
- Force-enable the child-only `ask_parent` tool after applying `tools` and `disallowed_tools`; frontmatter cannot disable it. A sole-tool call atomically writes one correlated request mailbox and returns `terminate: true`, leaving the pane alive and idle without an abort. Parent guidance uses `Agent.resume`: mailbox-deliver to live idle or active children, or reopen a closed persisted session. Interactive lifecycle and pending-request state remain independent; submitting a terminal prompt never cancels the request.
- Never propagate main-quest interruption and never expose `subagent_interrupt` to the model or an interrupt action in the parent widget. Interrupt a child only from its own pane through Pi's effective `app.interrupt` action.
- Preserve HazAT's restrained parent live-widget frame and rows. `/side-quests` enters navigation mode without a global shortcut: effective selection actions move a restrained chevron highlight, confirm jumps the invoking tmux client to the selected pane, cancel returns to the editor, and scoped `d` asks for confirmation before closing that child as a trusted cancellation. Navigation keys never apply while ordinary editor input owns focus.
- Replace HazAT's child tools widget with a compact identity line showing `display_name` when present or canonical agent name otherwise, current `Agent.description`, lifecycle mode, and pending-parent state. Never show both display and canonical names. Remove tool lists and the `Ctrl+J` expansion shortcut.
- On parent quit, process loss, or session replacement (`new`, `resume`, or `fork`), terminate every child owned by that parent session without deleting its session files or emitting terminal handoffs. `/reload` instead hands live children to the new extension instance. Children monitor unique owner liveness plus an owner lease so abrupt parent loss or failed reload cannot orphan them.
- Do not hard-code, inspect, replay, or duplicate Pi's interrupt keybinding. For user-visible shortcut labels, render effective bindings through the corresponding action ID; completion expansion uses `app.tools.expand`.
- Keep parent orchestration inert in child sessions, but load a child-only runtime companion from the same package for activity, heartbeat, takeover, and resolved lifecycle behavior. It never registers `Agent` or another spawning tool.
- Track child status through atomically replaced runtime snapshots plus a periodic heartbeat and parent one-second polling. After 60 seconds, missing, invalid, wrong-child, or stale-heartbeat snapshots become `stalled`; never infer stalled from task duration or transcript inactivity.
- In the same poll, verify canonical tmux pane IDs still exist. After one grace poll for a racing terminal marker, classify any unmarked disappearance as `closed`, including clean process quit, EOF, pane/window removal, or an uncaptured crash. Wake the parent, preserve its resumable session, remove its widget row, and reflow; never misreport it as completed or infer who closed it. Captured failures stay `failed`, and expected parent-shutdown teardown stays silent.
- Start every new child in the parent session's current working directory at invocation, passed explicitly to tmux pane creation. Expose no per-call or frontmatter `cwd` override.

## Decisions so far

<!-- One line per resolved child ticket: gist plus link. -->

- [Agent Interface](tickets/01-agent-interface.md) — `Agent` always launches or resumes asynchronously, returns the canonical child session path immediately, and later hands the final assistant response plus that path back to the parent without injecting the transcript.
- [Pane Layout Modes](tickets/02-pane-layout-modes.md) — `binary` and `ternary` globally recompute deterministic breadth-first geometry, transpose canonically for portrait windows, include manual panes during lifecycle reflow, and preserve pane processes.
- [Agent Configuration](tickets/03-agent-configuration.md) — project/global definitions apply strict parent-clone overrides for model, thinking, tools, skills, context, and pane mode; invalid or disabled winning definitions fail closed, while unsupported shared-file fields remain ignored.
- [HazAT Feature Audit](tickets/04-hazat-feature-audit.md) — HazAT remains the runtime and restrained-UX baseline; `side-quests` keeps only the audited tmux, lifecycle, activity, and takeover behavior recorded above.
- [Tintinweb Compatibility Delta](tickets/05-tintinweb-compatibility-delta.md) — Tintinweb contributes only the `Agent` name, selected request names, and selected shared frontmatter names; it contributes no runtime or UI behavior.
- [Side-Quest Session Storage](tickets/06-session-storage.md) — managed session manifests and mailboxes remain resumable outside Pi's session tree, while validated runtime snapshots can be cleaned independently.
- [Reload Continuity](tickets/07-reload-continuity.md) — `/reload` adopts children through persisted owner state, reconstructs the widget and layout, and uses stable event IDs for idempotent delivery.
- [Verification and Acceptance Boundaries](tickets/08-acceptance-boundaries.md) — acceptance requires strict contract checks plus real Pi-in-tmux lifecycle, layout, focus, UI, reload, and orphan-cleanup evidence.

## Not yet specified

- None. Wayfinding is complete.

## Out of scope

- Implementing the extension during wayfinding.
- Building an orchestrator or mandatory delegation policy.
- Synchronous `Agent` execution in the MVP; keep it as a future backlog option.
- Supporting cmux, Zellij, WezTerm, or a non-tmux fallback.
- Launching Claude Code CLI or any non-Pi child agent runtime.
