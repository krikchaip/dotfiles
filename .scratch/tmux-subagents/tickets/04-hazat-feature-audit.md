# HazAT Feature Audit

Type: grilling
Status: claimed

## Question

Walking through `hazat/pi-interactive-subagents`' README in order, which features and behaviors should `side-quests` retain, simplify, replace, or exclude, and which earlier wayfinding decisions should change?

## Comments

- Use the upstream README as the concrete top-down outline instead of designing behavior from first principles.
- HazAT is the default runtime and UX baseline. Retain each feature unless the audit explicitly simplifies, replaces, or excludes it.
- For each section, record upstream behavior, `side-quests` disposition, replacement behavior when applicable, and rationale.
- Inspect source when README wording is incomplete or disagrees with current behavior.
- [Agent Interface](01-agent-interface.md), [Pane Layout Modes](02-pane-layout-modes.md), and [Agent Configuration](03-agent-configuration.md) remain the baseline, but this audit may explicitly revise them.
- Consult `tintinweb/pi-subagents` only when a HazAT section reaches tool compatibility or inspires a targeted addition; defer a narrow compatibility-delta check until the HazAT audit is complete.
- Exact session-directory structure, retention, window collision handling, and acceptance tests may remain dedicated follow-up tickets.
- Creating or resuming a side-quest pane does not steal tmux focus from the main quest. The user switches to the shared side-quest window explicitly.

### How It Works — retained with targeted replacements

- Retain asynchronous launch, one isolated Pi process and persistent session per side quest, concurrent launches, a restrained above-editor status widget, and completion/failure delivery that wakes the parent model.
- Replace HazAT's `subagent` tool with the resolved `Agent` interface.
- Replace independent multiplexer placement with one shared tmux window per main quest and the resolved `binary` or `ternary` layout.
- Support Pi on tmux only; exclude HazAT's other runtimes and multiplexer backends.
- Retain HazAT's child-written activity snapshots and one-second parent polling. Tiny per-child reads favor deterministic behavior over `fs.watch` complexity and missed-event recovery. Add a periodic child heartbeat so a readable but frozen snapshot eventually becomes unhealthy; heartbeat age measures child event-loop liveness, never task progress.
- Retain Pi activity states `starting`, `active`, `waiting`, and `stalled`. Exclude `running`, which is only HazAT's fallback for runtimes without Pi snapshots. Completion and failure remain terminal notification outcomes rather than persistent widget states.

### Install — simplified to tmux-only package

- Package under `packages/side-quests` using the repository's existing Pi package structure.
- Retain startup environment validation and focus-preserving pane creation.
- Outside tmux, warn once, register nothing, and remain inert.
- Exclude cmux, Zellij, WezTerm, `PI_SUBAGENT_MUX`, and all backend-selection logic.
- Exclude `PI_SUBAGENT_SHELL_READY_DELAY_MS`; launch Pi directly as the tmux pane command instead of opening an interactive shell and sending keystrokes.

### What's Included — resolved with a smaller surface

- Replace HazAT's parent-facing tools with the single resolved `Agent` tool; fold resume into `Agent.resume` and expose the discovered catalog through the parent system prompt instead of `subagents_list`.
- Do not expose a model-callable `subagent_interrupt` tool. Observe raw terminal input in the main session without consuming it and match it against Pi's effective `app.interrupt` keybinding through the active keybindings manager. When any configured interrupt key matches while the main quest is running, forward the exact key input to every live side-quest pane so their active turns are interrupted without closing their sessions. Never hard-code Escape. The main quest still handles the original input normally, and interrupt input originating inside a child pane affects only that child.
- Exclude `/plan`, `/iterate`, and `/subagent`; the extension registers no parent-facing commands.
- Exclude all bundled agents. Discovery uses only the resolved project and global scopes.
- Revisit child-only `subagent_done` and `caller_ping` in their dedicated README sections.

### Async Subagent Flow — retained with compatibility handoffs

- Retain asynchronous launch, concurrent children, continued main-session interaction, live status, and completion or failure delivery that wakes the parent model.
- Retain HazAT's result extraction and failure distinctions. A successful handoff contains the child's final assistant response and canonical session path, not its full transcript. A nonzero exit includes the final assistant response when available and otherwise uses a fallback diagnostic. A provider or agent-loop error reports the underlying error plus retry/resume guidance instead of treating an earlier assistant message as a usable result. Cancellation reports cancellation. Add `closed` for a pane that disappears without a trusted terminal marker; include the final assistant response when available and the session path, but do not claim completion or user intent. Every terminal handoff includes the session path when one exists.
- Retain HazAT's restrained colored completion message and collapsed/expanded views. Expansion uses Pi's standard `app.tools.expand` action and renderer `options.expanded` state. Render its effective user-configured binding with `keyHint("app.tools.expand", ...)`; never display or register a hard-coded `Ctrl+O` shortcut.

### In-progress Status Updates — retained with stronger liveness

- A child-only companion entrypoint in the `side-quests` package subscribes to Pi lifecycle, provider, streaming, tool, input, and shutdown events. The parent-orchestration entrypoint remains inert in child sessions and registers no spawning surface there.
- The companion atomically replaces one small, schema-versioned JSON snapshot per live child. The snapshot carries the running-child ID, monotonic sequence, event timestamp, heartbeat timestamp, latest event, phase, active scope, tool details, and permanent interactive-takeover state. Streaming and tool-update writes may be throttled; lifecycle boundaries and takeover writes are immediate.
- The parent reads each snapshot once per second and validates its schema and running-child ID. In the same loop, verify every canonical tmux pane ID still exists. Do not use `fs.watch` or install server-global tmux hooks.
- Fix HazAT's destroyed-surface polling gap: when a tracked pane disappears, allow one additional poll for a racing terminal sidecar. A trusted `done`, autonomous-completion, help, or error marker wins; otherwise terminate tracking as `closed`, wake the parent, remove the widget row, reflow remaining panes, and preserve the session for `Agent.resume`. Expected pane removal during parent shutdown emits no notification.
- Preserve the 60-second watchdog for snapshots that never appear, are missing, invalid, belong to another child, or have a stale heartbeat. A current heartbeat keeps long-running `active` and `waiting` phases healthy regardless of their duration. Do not implement a task-progress timeout.
- `starting`, `active`, and `waiting` transitions update only the restrained widget. `stalled` and `recovered` additionally wake the parent model for autonomous children. Initially interactive children and permanently taken-over children remain widget-only.
- Keep status display active whenever live children exist. Exclude HazAT's package-local `config.json` status toggle.
