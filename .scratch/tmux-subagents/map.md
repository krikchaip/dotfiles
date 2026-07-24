# Side Quests

Label: wayfinder:map

## Destination

An implementation-ready specification for the tmux-only Pi `side-quests` extension, with a Claude Code-compatible `Agent` interface and a deliberately reduced `pi-interactive-subagents` runtime.

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
- Give each parent Pi session one shared sub-agent tmux window. Create it on first spawn, reuse it for that session, and remove it when its final sub-agent pane closes.
- Use the parent Pi session name directly as the visible tmux window name. Keep at most its first five words and append `...` when more words exist.
- Treat the parent session as the main quest and each persistent child session as a side quest. MVP `Agent` launches side quests asynchronously so the main quest never waits. Omit `run_in_background`; synchronous child-process waiting remains a future backlog option.
- Autonomous panes close when work finishes. Interactive panes stay open until explicitly finished.
- Manual input changes an autonomous pane into an interactive pane.
- Reapply the intended pane layout when agents start or stop instead of relying only on tmux reflow.
- Support locked `binary` and `ternary` pane-layout modes through one arity-based algorithm; canonical landscape and portrait geometry lives in `prototypes/pane_layout_prototype.py`.
- Final specification must clearly separate features removed, excluded, or simplified from `pi-interactive-subagents` from features added by this extension.
- Do not store child session files in the parent's normal Pi session folder. Defer exact `side-quests`-owned folder structure and retention policy.
- Discover named agents only from project `.pi/agents/` and global `$PI_CODING_AGENT_DIR/agents/`; project wins name collisions. Do not scan `.agents/agents/` or ship bundled agents. An omitted `subagent_type` clones the parent's current runtime configuration, but conversation history remains gated by `inherit_context`; there is no explicit `"default"` enum value.
- Never expose `Agent` or any other subagent-spawning tool inside a subagent, regardless of inherited or requested permissions.
- When any key bound to Pi's `app.interrupt` action interrupts the main quest, broadcast that key input to every live side-quest pane without consuming the main quest's input. Never hard-code Escape. Interrupt input originating in a child pane remains local to that child.
- Never hard-code user-visible shortcut labels or duplicate Pi actions with extension shortcuts. Match Pi's effective keybindings and render hints with the corresponding action ID; completion expansion uses `app.tools.expand`.
- Keep parent orchestration inert in child sessions, but load a child-only runtime companion from the same package for activity, heartbeat, takeover, and resolved lifecycle behavior. It never registers `Agent` or another spawning tool.
- Track child status through atomically replaced runtime snapshots plus a periodic heartbeat and parent one-second polling. After 60 seconds, missing, invalid, wrong-child, or stale-heartbeat snapshots become `stalled`; never infer stalled from task duration or transcript inactivity.
- In the same poll, verify canonical tmux pane IDs still exist. After one grace poll for a racing terminal marker, classify an unmarked disappeared pane as `closed`, wake the parent, preserve its resumable session, remove its widget row, and reflow; never misreport it as completed or infer who closed it.

## Decisions so far

<!-- One line per resolved child ticket: gist plus link. -->

- [Agent Interface](tickets/01-agent-interface.md) — `Agent` always launches or resumes asynchronously, returns the canonical child session path immediately, and later hands the final assistant response plus that path back to the parent without injecting the transcript.
- [Pane Layout Modes](tickets/02-pane-layout-modes.md) — `binary` and `ternary` globally recompute deterministic breadth-first geometry, transpose canonically for portrait windows, include manual panes during lifecycle reflow, and preserve pane processes.
- [Agent Configuration](tickets/03-agent-configuration.md) — project/global definitions apply strict parent-clone overrides for model, thinking, tools, skills, context, and pane mode; invalid or disabled winning definitions fail closed, while unsupported shared-file fields remain ignored.

## Not yet specified

- Reliable window association when visible session names collide.
- Result delivery and minimal status visibility in the parent Pi session.
- Exact `side-quests`-owned child-session folder structure and persistence policy.
- Verification and acceptance boundaries for the final specification.

## Out of scope

- Implementing the extension during wayfinding.
- Building an orchestrator or mandatory delegation policy.
- Synchronous `Agent` execution in the MVP; keep it as a future backlog option.
- Supporting cmux, Zellij, WezTerm, or a non-tmux fallback.
- Launching Claude Code CLI or any non-Pi child agent runtime.
