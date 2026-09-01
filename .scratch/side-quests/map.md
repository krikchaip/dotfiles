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
- Keep actors and tasks distinct: the parent agent performs the main quest, and each sub-agent performs a side quest. Never use a quest term as an agent, session, process, or pane synonym.
- The model may use its judgment to delegate a side quest to a sub-agent when useful. Delegation is optional, not restricted to explicit user requests, and never forced on every task.
- Delegate coherent objectives with clear purpose and a return contract, not granular helper work the parent agent can perform directly while it works on the main quest. Research with synthesis, feature implementation, verified fixes, audits, and complete epic tasks can qualify. File fetching, reading, basic lookup, retrieval-only work, and search without a complete outcome never qualify. The parent agent owns review and acceptance of returned evidence or changes.
- Give each parent Pi session one shared sub-agent tmux window. Create it on first spawn and reuse it for that session. Remove it after the final managed pane closes only when no unmanaged panes remain; never kill a user-created pane merely to remove the window.
- Treat the shared tmux window title as presentation-only. While Side Quests owns it, show the normalized `Agent.description` of the selected managed child pane, or restore tmux's native automatic name when an unmanaged pane is selected. A detached launch never changes the title of the pane already selected. A user rename or window-local naming override permanently transfers title ownership to the user until that window is destroyed. Use the full session ID for ownership and the canonical tmux window ID for targeting.
- The parent agent performs the main quest. Each sub-agent performs a side quest in a persistent child session. MVP `Agent` launches sub-agents asynchronously so the parent agent can continue the main quest without waiting. Omit `run_in_background`; synchronous child-process waiting remains a future backlog option.
- Every child Pi pane can accept terminal input. `interactive` controls lifecycle only on new launch. Autonomous panes close only after an explicit side-quest completion declaration through `subagent_done`; a normal model turn end does nothing. After creation, only submitting an accepted non-command prompt from the live child terminal permanently changes an autonomous pane to persistent mode; `Agent.resume`, ordinary continuation, other extension-injected messages, editing, typing, pasting, navigation, and commands do not. Interactive lifecycle never demotes.
- Autonomous children expose `subagent_done` with one required non-empty `result`. Strong tool description, prompt snippet, and system Guidelines require the sub-agent to call it exactly once and alone after all work and validation. Promotion removes the tool and all of its model-facing prompt metadata. `/subagent-done` remains available to humans in both lifecycles, accepts no arguments, and starts one hidden turn with only `subagent_done` active. A successful call records the trusted result, returns `terminate: true`, renders as the single persisted `WRAP UP` banner, and lets settlement close without starting another turn. A missed, aborted, or failed command turn restores prior tools and stays open without an automatic retry.
- Reapply the intended pane layout when agents start or stop instead of relying only on tmux reflow.
- Support locked `binary` and `ternary` pane-layout modes through one arity-based algorithm; canonical landscape and portrait geometry lives in `prototypes/pane_layout_prototype.py`.
- Final specification must clearly separate features removed, excluded, or simplified from `pi-interactive-subagents` from features added by this extension.
- Store child sessions under `$PI_CODING_AGENT_DIR/side-quests/sessions/<parent-session-uuid>/<child-session-uuid>/`, outside Pi's normal session tree. Retain session data until explicit deletion; runtime files are replaceable state.
- Discover agent definitions only from project `.pi/agents/` and global `$PI_CODING_AGENT_DIR/agents/`; project wins name collisions. Do not scan `.agents/agents/` or ship bundled agents. Omitted `subagent_type` and explicit `general-purpose` select the same standard parent clone. Optional `general-purpose.md` files apply normal agent overrides; project shadows global, malformed winners fail closed, and `enabled: false` removes customization without disabling the standard agent. The full valid non-general-purpose catalog appears in the parent system prompt's `Guidelines` section. `subagent_type`, `inherit_context`, and `interactive` are new-launch-only parameters; their parameter descriptions and parent system-prompt guidance say to omit them on resume, and runtime validation rejects a resume containing any of them. Keep the short `Agent` description unchanged. Resolved identity, context choice, lifecycle, capabilities, and prompt policy cannot be changed by resume.
- Never expose `Agent` or any other subagent-spawning tool inside a subagent, regardless of inherited or requested permissions.
- Force-enable the child-only `ask_parent` tool after applying `tools` and `disallowed_tools`; frontmatter cannot disable it. The first call atomically writes one correlated request and returns normally without terminating the turn or shutting down the child; sibling tools and later work continue, while another `ask_parent` fails until the request is answered. No tool except `subagent_done` can authorize successful child shutdown. A new `Agent.prompt` is a normal user-role message. Every `Agent.resume` prompt is a persisted custom message: deliver it immediately to a live idle child, queue it as `steer` for a live active child, or reopen a closed persisted session. Parent `reply needed` and child `reply pending` state remain independent of activity and lifecycle; explicit autonomous completion does not discard an unanswered request, and a `closed` handoff states when one remains.
- Never propagate parent-agent interruption and never expose `subagent_interrupt` to the model or an interrupt action in the parent widget. Interrupt a child only from its own pane through Pi's effective `app.interrupt` action.
- Preserve HazAT's restrained parent live-widget frame and rows, but use Pi's active theme for semantic colors: `muted` frame, bold `accent` title and identity, `dim` elapsed time, and state colors (`accent` starting, `success` active, `muted` waiting, `error` stalled, `warning` reply needed). `Shift+Up` and `/side-quests` enter the same navigation mode: effective selection actions move an accent chevron highlight, confirm jumps the invoking tmux client to the selected pane, cancel returns to the editor, and scoped `d` asks for confirmation before closing that child as a trusted cancellation. Navigation keys never apply while ordinary editor input owns focus.
- Replace HazAT's child tools widget with a compact bordered identity box: agent display or canonical name in the title, then `HH:MM:SS`, current `Agent.description`, lifecycle mode, and pending-parent state in one padded row. Never show both display and canonical names. Apply the same active-theme hierarchy: `muted` frame and lifecycle, bold `accent` title, `dim` elapsed time, and `warning` when a reply is pending. Remove tool lists and the `Ctrl+J` expansion shortcut. `Shift+Up` focuses the canonical parent tmux pane from any child.
- On parent quit, process loss, or session replacement (`new`, `resume`, or `fork`), terminate every child owned by that parent session without deleting its session files or emitting terminal handoffs. `/reload` instead hands live children to the new extension instance. Children monitor unique owner liveness plus an owner lease so abrupt parent loss or failed reload cannot orphan them.
- Do not hard-code, inspect, replay, or duplicate Pi's interrupt keybinding. For user-visible shortcut labels, render effective bindings through the corresponding action ID; completion expansion uses `app.tools.expand`.
- Keep parent orchestration inert in child sessions, but load a child-only runtime companion from the same package for activity, heartbeat, takeover, and resolved lifecycle behavior. It never registers `Agent` or another spawning tool.
- Track child status through atomically replaced runtime snapshots plus a periodic heartbeat and parent one-second polling. After 60 seconds, missing, invalid, wrong-child, or stale-heartbeat snapshots become `stalled`; never infer stalled from task duration or transcript inactivity.
- Treat an exhausted provider or agent-loop error as terminal `failed` for an autonomous child, but as a local failed turn for an interactive child whose Pi process remains healthy; keep that pane open, return its row to `waiting`, and do not wake the parent. A fatal or nonzero process exit is terminal `failed` in either lifecycle. In the same poll, verify canonical tmux pane IDs still exist. After one grace poll for a racing terminal marker, classify any unmarked disappearance as `closed`, including clean process quit, EOF, pane/window removal, or an uncaptured crash. Wake the parent, preserve its resumable session, remove its widget row, and reflow; never misreport it as completed or infer who closed it. Captured terminal failures stay `failed`, and expected parent-shutdown teardown stays silent.
- Start every new child in the parent session's current working directory at invocation, passed explicitly to tmux pane creation. Expose no per-call or frontmatter `cwd` override.

## Decisions so far

<!-- One line per resolved child ticket: gist plus link. -->

- [Agent Interface](tickets/01-agent-interface.md) — `Agent` always launches or resumes asynchronously, treats identity, context, and lifecycle parameters as new-launch-only, guides interactive use for multi-round human dialogue, returns the canonical child session path immediately, and later hands the current-run final response plus that path back to the parent without injecting the transcript.
- [Pane Layout Modes](tickets/02-pane-layout-modes.md) — `binary` and `ternary` globally recompute deterministic breadth-first geometry, transpose canonically for portrait windows, include manual panes during lifecycle reflow, and preserve pane processes.
- [Agent Configuration](tickets/03-agent-configuration.md) — configurable `general-purpose` and named project/global definitions apply strict parent-clone overrides; named descriptions form the `Guidelines` catalog, malformed winners fail closed, and unsupported shared-file fields remain ignored.
- [HazAT Feature Audit](tickets/04-hazat-feature-audit.md) — HazAT remains the runtime and restrained-UX baseline; `side-quests` keeps only the audited tmux, lifecycle, activity, takeover, and selected-pane window-title behavior recorded above.
- [Tintinweb Compatibility Delta](tickets/05-tintinweb-compatibility-delta.md) — Tintinweb contributes only the `Agent` name, selected request names, and selected shared frontmatter names; it contributes no runtime or UI behavior.
- [Sub-Agent Session Storage](tickets/06-session-storage.md) — managed session manifests and mailboxes remain resumable outside Pi's session tree, while validated runtime snapshots can be cleaned independently.
- [Reload Continuity](tickets/07-reload-continuity.md) — `/reload` adopts children through persisted owner state, reconstructs the widget and layout, and uses stable event IDs for idempotent delivery.
- [Verification and Acceptance Boundaries](tickets/08-acceptance-boundaries.md) — acceptance requires strict contract checks plus real Pi-in-tmux lifecycle, layout, focus, UI, reload, and orphan-cleanup evidence. The final UI amendment adds active-theme semantic widget colors and `Shift+Up` parent/child pane navigation.

## Not yet specified

- None. Wayfinding is complete.

## Out of scope

- Implementing the extension during wayfinding.
- Building an orchestrator or mandatory delegation policy.
- Synchronous `Agent` execution in the MVP; keep it as a future backlog option.
- Supporting cmux, Zellij, WezTerm, or a non-tmux fallback.
- Launching Claude Code CLI or any non-Pi child agent runtime.
