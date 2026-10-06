# Tickets: Side Quests

These tickets build the tmux-only Pi `side-quests` extension specified in [spec.md](spec.md), using [map.md](map.md), the resolved wayfinder tickets, the pane-layout prototype, and the package README as decision sources.

**Domain terms:** Parent agent and sub-agent name actors. Main quest and side quest name tasks. A side quest is a meaningful, self-contained task with reviewable evidence, not a sub-agent, session, pane, file fetch, file read, basic lookup, or retrieval-only operation.

Work the **frontier**: any ticket whose blockers are all done. Tickets 13, 14, and 15 form the parallel frontier after the MVP.

## Implementation issues

- [11: Establish package architecture and verification loop](issues/11-establish-package-architecture-and-verification-loop.md)
- [12: Deliver the complete day-to-day MVP](issues/12-deliver-the-complete-day-to-day-mvp.md)
- [13: Configure general-purpose and named agents](issues/13-configure-general-purpose-and-named-agents.md)
- [14: Detect stalls and recoveries](issues/14-detect-stalls-and-recoveries.md)
- [15: Apply deterministic and safe tmux layouts](issues/15-apply-deterministic-and-safe-tmux-layouts.md)
- [16: Survive reload, replacement, and owner loss](issues/16-survive-reload-replacement-and-owner-loss.md)
- [17: Complete full specification conformance](issues/17-complete-full-specification-conformance.md)
- [18: Layer project Agent definitions over global definitions](issues/18-layer-project-agent-definitions-over-global-definitions.md)
- [19: Define unified Agent capability selection](issues/19-define-unified-agent-capability-selection.md)

## Backlog

- [20: Open closed sub-agent sessions interactively](issues/20-open-closed-sub-agent-sessions-interactively.md)
- [21: Human-friendly sub-agent references](issues/21-human-friendly-sub-agent-references.md)
- [22: Deterministic child-exit synchronization](issues/22-deterministic-child-exit-synchronization.md)

## Historical numbering

Research issues retain `01–10`. Implementation issues formerly in the combined file now follow them. The original comment text below retains its historical identifiers; use this table to resolve them.

| Original implementation ticket | Current issue |
| --- | --- |
| 1 | [11](issues/11-establish-package-architecture-and-verification-loop.md) |
| 2 | [12](issues/12-deliver-the-complete-day-to-day-mvp.md) |
| 3 | [13](issues/13-configure-general-purpose-and-named-agents.md) |
| 4 | [14](issues/14-detect-stalls-and-recoveries.md) |
| 5 | [15](issues/15-apply-deterministic-and-safe-tmux-layouts.md) |
| 6 | [16](issues/16-survive-reload-replacement-and-owner-loss.md) |
| 7 | [17](issues/17-complete-full-specification-conformance.md) |
| 8 | [18](issues/18-layer-project-agent-definitions-over-global-definitions.md) |
| 10 | [19](issues/19-define-unified-agent-capability-selection.md) |

## Comments

- Ticket 1 claimed. The composition root is approved. Parent and child each use a barrel `index.ts`; both surfaces are split into `parent/index.ts`, `parent/runtime.ts`, `parent/ui.ts`, and `child/index.ts`, `child/runtime.ts`, `child/ui.ts`. Storage stays as direct `store/*.ts` imports without a barrel. `agent-definitions/` owns definition discovery and immutable child capability resolution, and has one barrel `agent-definitions/index.ts` that encapsulates its internal parts. Tmux starts as one cohesive `tmux.ts` module; it alone runs tmux commands and identifies managed panes/windows through persisted canonical IDs and full owner IDs, never display names or pane geometry. `parent/runtime.ts` owns Pi registrations, polling, coordination, persistence/tmux calls, and parent event delivery. `parent/ui.ts` only renders and emits navigation intents; the runtime validates and applies them. The parent and child runtime/UI boundaries are provisionally approved and can be refined when concrete behavior exists. `child/runtime.ts` owns child tools, activity and lifecycle state, terminal-state writes, and dynamic child commands; `child/ui.ts` only renders its runtime-provided identity view. Each `store/` file is named for its storage type (for example, `manifest.ts`, `mailbox.ts`, `activity.ts`, and `terminal.ts`), with separate direct-import domain-operation utilities where needed. `store/` has no barrel. Testing follows a reverse pyramid: user-journey E2E tests are primary; integration tests are next; small focused unit tests cover low-cost deterministic logic such as pane layout. The otherwise inert unsupported-tmux path may register one `session_start` hook solely to show its one warning; it must register nothing else.
