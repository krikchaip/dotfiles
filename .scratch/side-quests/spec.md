# Side Quests

Status: ready-for-agent

## Problem Statement

Pi users need a safe way to delegate coherent, independently reviewable work without blocking the main Pi session or hiding work in headless background processes. Existing interactive-subagent behavior provides the right tmux-first runtime and restrained UI, but its public tools, broad multiplexer support, and package surface do not match this workflow. Claude Code-style subagent packages provide useful `Agent` and frontmatter names, but their runtime, UI, polling tools, queueing, and orchestration model are not the desired product.

Users need one maintainable Pi package that keeps the interactive tmux experience, exposes a narrow `Agent` naming surface, preserves every child as a resumable Pi session, prevents nested delegation and permission growth, and reports child state without stealing focus from the main quest.

## Solution

Build a private local Pi package named `side-quests`. It launches Pi child sessions in one dedicated tmux window owned by the current main quest. Each side quest receives a coherent handoff, runs asynchronously in its own pane, writes activity snapshots, and returns its final assistant response to the main quest. The user can inspect or take over any pane directly.

Use `hazat/pi-interactive-subagents` as the runtime and restrained-UX baseline. Use `tintinweb/pi-subagents` only for the `Agent` name, selected request fields, and selected shared frontmatter names. Do not copy Tintinweb runtime or UI behavior.

Keep the package entrypoint small. Follow the image-attachments package's useful composition-root pattern, but improve locality: group behavior into deep modules that own cohesive state and policy instead of creating one shallow module per Pi event. Keep parent orchestration, child runtime, definition resolution, persistence, tmux control/layout, event delivery, and TUI rendering separate behind small interfaces.

## User Stories

1. As a Pi user, I want the main quest to delegate a coherent objective, so that it can continue other work while a side quest runs.
2. As a Pi user, I want delegation to remain optional, so that simple work stays in the main quest.
3. As a Pi user, I want retrieval-only work to stay in the main quest, so that side quests remain useful and independently reviewable.
4. As a main quest, I want each side-quest handoff to include purpose, context, constraints, expected outcome, and acceptance evidence, so that the child can work independently.
5. As a main quest, I want to launch several side quests concurrently, so that independent outcomes can progress in parallel.
6. As a main quest, I want `Agent` to acknowledge launch immediately after the pane and session exist, so that I can continue without waiting for completion.
7. As a main quest, I want one stable session path for each side quest, so that I can resume the same context later.
8. As a main quest, I want a child result to contain its final assistant response and session path, so that I can review evidence without importing the full transcript.
9. As a main quest, I want failures to retain useful final output when available, so that partial evidence is not lost.
10. As a main quest, I want provider and agent-loop errors reported as errors, so that stale assistant text is not mistaken for success.
11. As a main quest, I want unmarked pane disappearance reported as `closed`, so that the extension never invents completion or user intent.
12. As a main quest, I want returned work to remain subject to my review, so that delegation never becomes blind acceptance.
13. As a Pi user, I want named agents discovered from project and global definitions, so that projects can specialize global roles.
14. As a Pi user, I want project definitions to shadow same-name global definitions, so that local policy is authoritative.
15. As a Pi user, I want a malformed project definition to fail closed, so that a global definition cannot bypass local intent.
16. As a Pi user, I want a project tombstone to disable a global agent, so that unwanted roles can be removed locally.
17. As a Pi user, I want agent names to be case-sensitive filename stems, so that lookup and shadowing are deterministic.
18. As a main quest, I want the full normalized description of every valid agent in my system prompt, so that I can select roles accurately.
19. As a main quest, I want to omit `subagent_type` for general-purpose work, so that the child clones my current runtime configuration.
20. As a main quest, I want unknown agent names to fail before launch, so that work never starts under an unintended fallback.
21. As a main quest, I want context inheritance enabled by default, so that continuation tasks receive relevant conversation.
22. As a main quest, I want to disable context inheritance, so that independent or adversarial review starts unbiased.
23. As an agent-definition author, I want exact model and thinking settings, so that named roles run with predictable capabilities.
24. As an agent-definition author, I want exact tool allowlists and denylists, so that child permissions are explicit.
25. As an agent-definition author, I want lazy and preloaded skill controls, so that children receive only intended guidance.
26. As a Pi user, I want unsupported shared frontmatter ignored, so that one agent file can coexist with other extensions.
27. As a Pi user, I want child tool permissions to remain fixed after takeover and resume, so that interaction cannot escalate capability.
28. As a Pi user, I want every spawning tool denied inside children, so that side quests cannot create nested agents.
29. As a side quest, I want `ask_parent` always available, so that restrictive tool policy cannot remove my control channel.
30. As a side quest, I want one pending parent question at a time, so that responses cannot become ambiguous.
31. As a side quest, I want `ask_parent` to send my question without ending my turn, so that I can continue independent work instead of waiting.
32. As a main quest, I want an `ask_parent` request to wake me, so that the unanswered question receives attention.
33. As a main quest, I want `Agent.resume` to answer a pending question, so that one interface owns all continuation.
34. As a main quest, I want guidance sent to a live active child after its current tool batch without aborting it, so that work changes direction safely.
35. As a main quest, I want a stopped child reopened from its session when resumed, so that closed panes do not destroy continuity.
36. As a Pi user, I want every child pane to accept terminal input, so that I can inspect and take over work directly.
37. As a Pi user, I want autonomous panes to close after normal completion, so that finished work does not leave clutter.
38. As a Pi user, I want initially interactive panes to remain open, so that continuing terminal work stays available.
39. As a Pi user, I want either explicit `Agent.resume` promotion or an accepted non-command prompt from a child terminal to promote that session permanently to interactive mode, so that takeover is explicit.
40. As a Pi user, I want typing, editing, commands, ordinary parent continuations, and other programmatic messages not to promote lifecycle, so that incidental input does not change cleanup behavior.
41. As a Pi user, I want `/subagent-done` registered only for initially or permanently promoted interactive children, so that autonomous panes do not advertise an inapplicable completion command.
42. As a Pi user, I want `/subagent-done` to close an idle interactive child cleanly and refuse during an active turn, so that completion is explicit and streaming work is not misclassified.
43. As a Pi user, I want child interruption to use Pi's normal action inside that child pane, so that interruption stays local.
44. As a Pi user, I want main-quest interruption to affect only the main quest, so that child work is not broadcast-cancelled.
45. As a Pi user, I want launches and resumes not to steal tmux focus, so that my main-quest workflow stays stable.
46. As a Pi user, I want one side-quest window per main quest, so that related child panes remain easy to find.
47. As a Pi user, I want the window name to show the short main-session UUID, so that it is recognizable without becoming an ownership key.
48. As a Pi user, I want deterministic binary and ternary layouts, so that pane placement does not depend on tmux's incidental history.
49. As a Pi user, I want portrait layouts to be geometric transposes of landscape layouts, so that ordering remains predictable.
50. As a Pi user, I want pane layout recomputed when managed children start or stop, so that gaps and stale geometry disappear.
51. As a Pi user, I want manually created panes preserved, so that the extension never kills unrelated work.
52. As a Pi user, I want manual panes included at the next managed reflow, so that the whole shared window remains usable.
53. As a Pi user, I want window resize handled without process loss, so that geometry recovers when terminal dimensions change.
54. As a Pi user, I want a restrained live-status widget above the parent editor, so that I can monitor children without a dense dashboard.
55. As a Pi user, I want `/side-quests` to enter row navigation, so that I can select a child without a global shortcut.
56. As a Pi user, I want navigation to use my effective Pi selection bindings, so that the UI respects my configuration.
57. As a Pi user, I want confirmation before closing a selected child, so that active work is not destroyed by one keypress.
58. As a Pi user, I want selected-row identity stable across status changes, so that duplicate labels or row reorder do not move selection.
59. As a Pi user, I want each child to show a compact bordered identity box, so that its role, elapsed time, task, lifecycle, and pending-reply state are clear.
60. As a Pi user, I want narrow-terminal truncation to preserve agent identity and lifecycle state, so that important status remains visible.
61. As a main quest, I want starting, active, waiting, and stalled status, so that I can distinguish lifecycle and liveness.
62. As a main quest, I want heartbeat staleness detected without a task-duration timeout, so that frozen children are reported without penalizing long work.
63. As a main quest, I want autonomous stall and recovery events to wake me, so that unhealthy delegated work receives review.
64. As a Pi user, I want interactive child stalls to remain widget-only, so that my manual session does not inject model turns.
65. As a Pi user, I want `/reload` to preserve active side quests, so that extension reload does not discard work.
66. As a Pi user, I want events written during reload delivered once, so that completion is neither lost nor duplicated.
67. As a Pi user, I want parent quit, session replacement, or process loss to terminate owned children, so that agents cannot become orphans.
68. As a Pi user, I want broken reload to expire an owner lease, so that children stop even if the parent process remains alive without the extension.
69. As a Pi user, I want child sessions retained after closure, cancellation, failure, shutdown, and reload, so that work remains resumable.
70. As a Pi user, I want side-quest sessions absent from normal `/resume`, so that regular session selection stays clean.
71. As a Pi user, I want resume paths validated inside the managed storage root, so that `Agent` cannot open arbitrary files.
72. As a Pi user outside tmux, I want one clear warning and no active extension surface, so that unsupported environments remain safe and quiet.
73. As a maintainer, I want the extension packaged as a normal local Pi package, so that installation and reload follow existing repository conventions.
74. As a maintainer, I want a small composition root and cohesive deep modules, so that state and policy changes stay local.
75. As a maintainer, I want real Pi-in-tmux behavior as the primary test seam, so that tests cover what users experience.

## Implementation Decisions

- Build `side-quests` as a private local Pi package in the repository's managed Pi packages area. Its package manifest explicitly exposes one parent extension entrypoint. A child companion entrypoint remains package-internal and is loaded explicitly for child Pi processes.
- Use the image-attachments package only as a structural reference: a small package manifest, a small composition root, and cohesive feature modules. Improve on it by grouping behavior around owned state and invariants rather than one installer per event hook.
- Keep the composition root declarative. It selects inert, parent, or child behavior and composes modules. It must not contain definition parsing, process control, storage rules, layout logic, polling, or rendering logic.
- Prefer these deep modules: agent catalog and policy resolution; persisted session/mailbox store; tmux owner/window/layout control; parent runtime coordination and event delivery; parent widget/navigation; and child companion lifecycle/activity. Each module exposes a small interface and owns its internal state. Avoid pass-through wrappers and a general event bus.
- Treat the complete installed Pi extension as the primary external seam. Parent and child runtime modules may have internal seams only where two adapters exist, such as real tmux/filesystem behavior and a deterministic test adapter. Do not wrap every Node or Pi call only to make it mockable.
- Use only Node built-ins and Pi-provided packages unless a new runtime dependency has a clear need. Keep Pi core imports compatible with Pi package peer-dependency rules.
- Detect the child role before parent registration. In a child process, the normal package entrypoint is inert, and only the explicitly loaded child companion registers child behavior. No child process can register `Agent` or any spawning surface.
- Outside tmux, emit one startup warning and return before registering tools, commands, hooks, timers, widgets, or child resources.

- Register exactly one public model tool named `Agent` with this request contract: required non-empty `prompt` and `description`; optional `subagent_type`, `resume`, `inherit_context`, and `interactive`; no additional properties. `description` is preferably two to six words and labels the pane and status row.
- Build `subagent_type` as a registration-time enum of valid resolved named agents. Omission means general-purpose parent clone. There is no `default` enum value. Agent-definition changes reach the enum after `/reload`.
- `resume` is an absolute managed child session path. When it is present, `prompt` is continuation text and `description` is the new task label. Reject `subagent_type` and `inherit_context` on resume. Omitted `interactive` preserves prior lifecycle; explicit `true` promotes permanently; `false` cannot demote.
- For a new launch, append `prompt` as a normal user-role message after any one-time inherited conversation. It is the first conversation message when `inherit_context` is false. Do not represent the launch prompt as a custom message.
- Keep `Agent` always asynchronous. Launch returns after the pane has started and the child session file exists. Return structured details and model-visible text that distinguish new launch, live continuation, and reopened resume and always include the canonical session path.
- Do not expose result-polling or steering tools. A successful child terminal event persists one custom parent message containing the final assistant response, canonical session path, stable event ID, and collapsed/expanded presentation. It wakes the parent model. Do not inject the full child transcript.
- Use Pi's `app.tools.expand` action and `keyHint(...)` for expandable result hints. Do not register or display a hard-coded shortcut.
- Keep parent system-prompt additions small: define optional side-quest delegation, require coherent independently reviewable outcomes and a return contract, require main-quest review, and include the full valid agent catalog. Normalize description whitespace only. Do not duplicate the catalog in the short tool description.
- Keep “main quest,” “side quest,” “side-quest handoff,” and “side-quest review loop” as model-facing domain terms. Runtime statuses and user-facing result/error text use `Agent`, `subagent`, or the configured agent label.

- Discover named definitions from project `.pi/agents/*.md` and global `$PI_CODING_AGENT_DIR/agents/*.md`. Use exact case-sensitive filename stems. Project definitions shadow global definitions before validation. Do not scan `.agents/agents` and do not bundle agents.
- Parse definitions at parent extension registration. Valid enabled definitions require non-empty `description`; `enabled: false` is a tombstone and requires no body. A malformed winning definition stays shadowing, is removed from the catalog and enum, and emits one path-specific warning at startup or reload. Unknown fields are silently ignored.
- Consume only `description`, `display_name`, `enabled`, `model`, `thinking`, `tools`, `disallowed_tools`, `available_skills`, `preload_skills`, `inherit_context`, and `interactive`. The Markdown body contains optional agent instructions.
- Treat `display_name` as presentation only. Canonical identity, enum value, storage, shadowing, and resume continue to use the filename stem.
- Resolve named agents from the current parent runtime baseline. Omitted fields inherit current parent model, thinking, native system-prompt inputs, enabled tools, loaded extensions, and skills. Append preloaded skill bodies after native Pi prompt sections, then append the agent body.
- Require explicit models to match an exact `provider/model-id` in Pi's registry. Require thinking values from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; use Pi's native clamp when a valid level exceeds model support. Invalid explicit values abort launch without fallback.
- Omitted `tools` inherits the parent's enabled set. Present `tools` replaces it with `all`, `none`, or exact registered names. Apply `disallowed_tools` next. Unknown names abort launch. Hard-deny `Agent`, package spawning tools, and known subagent-spawning names after all user policy, then force-register and force-enable `ask_parent`.
- Keep resolved tool policy permanent in the child manifest. Interactive takeover, live continuation, reopened resume, changed parent settings, and changed agent files never broaden it. Missing required registered tools on reopen cause a clear resume error instead of fallback.
- `available_skills` omission inherits the parent lazy catalog; `true` selects normally model-invocable child-discovered skills; `false` selects none; an explicit list selects exact names and may override `disable-model-invocation`. `preload_skills` independently injects exact full skill bodies and removes those skills from the lazy catalog. Unknown names abort launch. If `read` is absent, omit a non-empty lazy catalog with a launch warning but still inject preloaded skills.
- `inherit_context` copies the parent active conversation once at launch. Per-call value overrides frontmatter; total omission defaults true. Later parent conversation is never synchronized.
- `interactive` controls lifecycle only. On new launch, the per-call value overrides frontmatter and total omission defaults false. On resume, explicit `true` permanently promotes an autonomous session, omission preserves lifecycle, and `false` cannot demote. Every pane remains terminal-interactive. An accepted non-command input with Pi source `interactive` also promotes permanently. Ordinary programmatic parent continuation, other extension-injected messages, commands, typing without submission, editing, pasting, and navigation do not promote.

- Launch only Pi. Start each child directly as the tmux pane command in the main quest's current CWD. Do not start an intermediate shell, send terminal keystrokes, or use a shell-ready delay.
- Give each main quest one shared side-quest tmux window. Create it detached on first launch and retain its canonical tmux window ID. Use the first hyphen-delimited parent session UUID segment only as the visible window name; use the full UUID and unique owner identity for all ownership checks.
- Create and resume panes detached. Never change the invoking client's current window or active pane. Pane jump is allowed only after explicit user confirmation in `/side-quests` navigation and targets the selected canonical pane ID for the invoking client.
- Preserve all unmanaged panes. Remove the shared window after the final managed pane closes only when no unmanaged panes remain. Never kill or replace an unmanaged pane process.
- Support package layout policy values `binary` and `ternary`, defaulting to `binary`. Load the choice at startup/reload. An invalid choice warns and uses `binary`.
- Use one arity-based layout implementation, with arity two for `binary` and three for `ternary`. For pane count `N`, let `P` be the greatest arity power not exceeding `N`, and `E = N - P`. Build the completed `P`-slot level by splitting each leaf along its longer rendered dimension, treating terminal cells as twice as tall as wide. Use side-by-side geometry when `width >= 2 × height`; otherwise use stacked geometry.
- At a partial level, visit each base target once and consume up to `arity - 1` additions. The retained left/top region holds unconsumed shares; each addition consumes one share on the right/bottom. Binary integer remainder goes right/bottom; ternary remainder goes left/top.
- In landscape, number base slots row-major and visit partial targets by rightmost column, bottom-to-top, then move left. In portrait, transpose the geometry, number column-major, and visit bottom row right-to-left, then move upward. Recompute complete geometry for every pane count; do not depend on prior tmux layout.
- Assign existing panes to canonical slots by stable pane identity order rather than current geometry. Include unmanaged panes as ordinary leaves. Do not reflow immediately when a user manually splits; reflow on the next managed child start/stop, reload adoption, or detected window-size change.
- If terminal dimensions cannot satisfy tmux's minimum valid pane geometry, preserve the current valid pane arrangement, warn once per size/count state, and retry after dimensions or pane count change. Never destroy a pane to force geometry.

- Store persistent data under `$PI_CODING_AGENT_DIR/side-quests`. Use one session directory per full parent UUID and full child UUID, containing Pi's `session.jsonl`, a resolved manifest, and persistent request/response mailboxes. Keep replaceable owner, activity, and terminal state in a separate runtime tree.
- Use the absolute `session.jsonl` path as the canonical child identifier. Accept a resume path only when its real path is a regular managed file and path segments, manifest IDs, and owner lineage agree. Reject symlink escapes, malformed manifests, missing files, and foreign sessions.
- Store canonical agent identity, display/task labels, CWD, model, thinking, exact tools, skill/system-prompt snapshot, context choice, lifecycle mode, parent lineage, and schema version in the manifest. Resolved capability and prompt-policy fields are immutable. Update task label and promoted lifecycle state atomically on continuation. Definition and parent-setting changes affect new children only.
- Create private directories and files with owner-only access. Write manifests, mailboxes, snapshots, owner records, and terminal sidecars atomically with temporary-file rename. Validate schema versions, owner IDs, child IDs, request IDs, and event IDs before use.
- Retain session data, manifests, and unanswered requests until explicit user deletion. Do not implement age-based deletion. Remove accepted responses and handled replaceable runtime state. Clean stale runtime state only after both owner process identity and owner lease are dead.
- Keep this storage root outside Pi's normal session hierarchy so side quests never appear in `/resume`.

- Use a private mailbox for `ask_parent`. Allow one outstanding request. The first call writes the request atomically. Sibling tool calls in the same batch remain valid and execute normally. Reject every later `ask_parent` call while that request is unanswered.
- A successful `ask_parent` returns an ordinary successful tool result without `terminate: true` and without calling `ctx.abort()`. The child continues its current turn and does not wait for a response. Autonomous completion remains allowed while the request is pending; preserve the unanswered request after completion or closure.
- `Agent.resume` is the only parent response interface. Every resume `prompt` is a persisted custom message, never a normal user-role message. For a live idle child, write and inject the matching custom message immediately and trigger a turn. For a live active child, queue the custom message as `steer` for delivery after the current tool batch without aborting. For a stopped child, reopen the session and inject the custom message as its first continuation. Clear a pending request only after matching response acceptance.
- Keep lifecycle mode, parent-request state, and activity independent. Show `reply needed` in the parent widget and `reply pending` in the child widget alongside activity or lifecycle state. An interactive terminal prompt can start child work while a parent request remains pending; it never clears that request.

- The child companion writes one small schema-versioned activity snapshot by atomic replacement. Include child ID, monotonic sequence, event time, heartbeat time, latest event, phase, active scope, tool details, lifecycle mode, and pending-parent state. Throttle streaming/tool updates; write lifecycle and takeover transitions immediately.
- The parent polls snapshots and canonical tmux pane IDs once per second. Do not use `fs.watch` or server-global tmux hooks. A missing, invalid, wrong-child, or heartbeat-stale snapshot becomes `stalled` after 60 seconds. Current heartbeat means healthy regardless of task duration.
- Use widget activity states `starting`, `active`, `waiting`, and `stalled`. Completion and failure are terminal messages, not persistent rows. Autonomous stall and recovery wake the parent; interactive sessions update the widget only.
- When a pane disappears, allow one extra poll for a racing trusted terminal sidecar. Trusted completion, autonomous completion, cancellation, or error wins. Otherwise report `closed`, include available final response and session path, remove the row, reflow, and preserve the session and pending mailbox.
- Use stable event IDs on completion, failure, cancellation, closure, stall/recovery, and parent requests. Persist parent custom messages with those IDs. Rebuild delivered IDs from the main session during reload before reading pending sidecars, giving idempotent at-most-once reinjection into the parent transcript.
- On `/reload`, the old instance stops timers and UI but leaves children and panes alive. The new instance validates and adopts owner/window/pane records for the same full parent UUID and unique process owner, processes pending terminal events, restores polling, recomputes layout, and renders the widget.
- Renew an owner lease during parent polling. Children validate the unique parent PID/process-start identity and the lease. Use a grace period long enough for normal reload, with 60 seconds as the default. If process identity dies or the lease expires after a broken/removed reload, children stop and retain sessions.
- On parent `quit`, `new`, `resume`, or `fork`, mark teardown expected, terminate all owned child processes and managed panes, suppress terminal handoffs, stop timers/UI, and retain persistent child data.

- Keep the parent widget visually close to HazAT's restrained frame: muted/blue border, title and live count, `HH:MM:SS` elapsed time, agent label, task label, and a right-side activity column. Widget width follows the available terminal width; no sample width is normative. Give every row exactly two visible cells of inner left and right padding and exactly two visible cells between the elapsed-time, agent/task, and activity columns. Compute shared column starts across all rendered rows and pad shorter values within their columns so each column's first visible character is vertically aligned while preserving the two-cell outer padding. When present, render `reply needed` after activity, such as `active · reply needed`. Use `display_name` or canonical name, never both. Truncate task labels first, then preserve identity, activity, column alignment, separators, and borders at narrow widths.
- Register only `/side-quests` in the parent. With no live children, notify and return. Otherwise enter an above-editor navigation mode with a restrained accent chevron on one row.
- Use Pi's effective `tui.select.up`, `tui.select.down`, `tui.select.confirm`, and `tui.select.cancel` actions. A scoped literal `d` asks for close confirmation and is rendered with `rawKeyHint`. These controls never affect ordinary editor input.
- Key selection by child ID. If selection disappears, choose the nearest surviving row. Confirm switches the invoking tmux client to the selected pane and exits navigation. Closing writes a trusted cancellation marker before removing the pane, then reflows and preserves the session.
- Provide no parent interrupt action. Child interruption occurs only in the child pane through Pi's effective `app.interrupt` action.
- Replace HazAT's child tool dashboard with one compact above-editor identity box. Put `[agent label]` in the top border. Render one content row as `HH:MM:SS`, task label, and `autonomous|interactive`, followed by `· reply pending` when needed. Use two visible cells of inner horizontal padding and two visible cells between content columns; width follows the child pane rather than a fixed sample width. Truncate the task label first on narrow terminals, preserving the agent title, lifecycle/request state, spacing, and borders. Do not include tool lists, expansion state, or a new shortcut.
- Register child-only `/subagent-done` dynamically for the current persisted interactive lifecycle: at startup for an initially interactive child, immediately after explicit `Agent.resume` promotion, and immediately after an autonomous child accepts a direct non-command prompt and becomes permanently interactive. Restore that registration after reload, adoption, or reopen from persisted lifecycle state, not only the original launch option. Do not register or show it while autonomous. An autonomous input guard rejects `/subagent-done` and `/subagent-done ...` without sending input to the model or promoting lifecycle. The command accepts no arguments; reject arguments with `Usage: /subagent-done`. While a model or tool turn is active, keep the pane open and tell the user to wait or interrupt first. While idle, atomically write trusted completion state, deliver the final assistant response as the completion result, and shut down while retaining the resumable session. An unanswered parent request remains persisted and does not block completion. Never register the command in the parent or expose it as a model tool.

## Testing Decisions

- Primary test seam: run the complete package in a real interactive Pi TUI inside an isolated tmux server/context. Drive behavior through public `Agent`, commands, terminal input, and lifecycle actions. Observe user-visible TUI, persisted parent messages, child session files, pane geometry, focus, and process liveness. Mock-only acceptance is not allowed.
- Supplement the primary seam with pure tests for definition/policy resolution, managed-path validation, event deduplication, lifecycle transitions, mailbox correlation, and canonical layout geometry. Test returned values and external state transitions, not private function calls or event-hook wiring.
- Treat the executable pane-layout prototype as the geometry oracle. Cover binary and ternary counts across completed and partial levels, landscape/portrait transposition, remainder placement, growth/shrink symmetry, stable pane assignment, tiny dimensions, and resize recovery.
- Test package startup outside tmux: exactly one warning and no tool, command, timer, hook-driven UI, or process surface.
- Test the exact `Agent` schema, dynamic enum refresh, required values, forbidden mixed resume fields, unknown properties, new launch, live idle continuation, live active steering, stopped reopen, duplicate-process prevention, startup failure cleanup, and canonical acknowledgements.
- Test project/global discovery, exact case, reserved default handling, tombstones, malformed project shadowing, one-warning behavior, full description catalog, unsupported-field ignoring, and reload refresh.
- Test model/thinking validation, parent inheritance, exact tool replacement/subtraction, unknown-tool failure, hard spawning denial, forced `ask_parent`, immutable resume policy, lazy skill selection, explicit hidden-skill selection, preloading, duplicate omission, unknown skills, and missing-read warning.
- In real tmux, launch enough panes to cover both layout modes, leftovers, portrait/landscape windows, manual panes, managed start/stop, pane close, whole-window close, resize, impossible-size fallback, and final-window cleanup. Assert exact rectangles from tmux, stable canonical IDs, preserved processes, no unmanaged-pane deletion, and unchanged main focus.
- E2E-test autonomous completion; initial and promoted interactive completion; `/subagent-done` absence and guarded input while autonomous; immediate dynamic registration after explicit resume promotion or terminal takeover; registration continuity across reload and reopen; argument rejection; active-turn refusal; idle success with and without a pending parent request; local child interrupt; parent interrupt isolation; trusted cancellation; failure; unmarked closure; stall; recovery; and resume.
- E2E-test `ask_parent` with and without sibling tool calls, continued child work after the successful result, duplicate-request rejection, autonomous completion with a pending request, idle response delivery, active custom-message steering, stopped response reopen, `reply needed` and `reply pending` indicators, matching-ID acceptance, reload survival, and one parent wake.
- E2E-test normal reload adoption and result delivery during the handoff. Test quit, new, resume, fork, abrupt parent death, expired owner lease after broken reload, and tmux-window deletion. No child process may leak; retained sessions must remain resumable where specified.
- Inspect real screenshots at normal and narrow widths for parent passive/navigation widgets, selected rows, effective key hints, the bordered child identity box, `HH:MM:SS` elapsed time, `reply needed` and `reply pending` states, two-cell outer padding and inter-column gaps, vertically aligned parent column starts, result collapsed/expanded rendering, clipping, wrapping, stale rows, and pixel-level frame defects.
- Verify side-quest sessions remain absent from normal `/resume`, foreign and symlink-escaped paths are rejected, permissions are private, atomic files remain parseable under races, and persistent data survives every required terminal state.
- Follow existing local package composition as maintainability prior art and HazAT's Pi activity/result behavior as product prior art. Use the repository's Pi-extension E2E procedure for TUI verification.
- Run formatting, typecheck, lint, unit tests, integration tests, prototype checks, and real E2E tests with no failures or flakes. Any focus theft, duplicate delivery, leaked process, stale widget, malformed layout, unrelated pane mutation, or visible UI defect blocks acceptance.

## Out of Scope

- Non-tmux environments, fallback terminal modes, cmux, Zellij, WezTerm, and multiplexer backend selection.
- Claude Code CLI or any child runtime other than Pi.
- Synchronous `Agent` calls, foreground waiting, `run_in_background`, polling tools, result tools, steering tools, or a general event RPC layer.
- Mandatory delegation, an orchestrator, task queues, groups, scheduling, or nested subagent spawning.
- Bundled agents, `.agents/agents` discovery, fuzzy model matching, cross-provider aliases, or a hidden-but-directly-invokable agent state.
- Per-call tools, skills, model, thinking, max turns, CWD, system prompt, isolation, worktree, memory, transcript, persistence, or scheduling parameters.
- Agent-definition extension loading, `skills` aliases, `prompt_mode`, `session-mode`, `auto-exit`, max-turn control, worktrees, memory, alternate transcript formats, and ephemeral child sessions.
- Parent-to-child broadcast interruption, parent widget interruption, terminal key replay, or hard-coded shortcut labels.
- HazAT `/plan`, `/iterate`, `/subagent`, child tool dashboards, status-toggle configuration, alternate runtimes, and bundled roles.
- Tintinweb Fleet UI, built-in agents, queue/group controls, nested delegation, worktrees, scheduler, memory, result polling, and tolerant model resolution.
- Automatic persistent-session expiry, an MVP cleanup command/UI, and automatic age-based deletion.
- General tmux session management or mutation of panes outside the main quest's owned side-quest window.

## Further Notes

- Runtime and restrained-UX reference: https://github.com/hazat/pi-interactive-subagents
- Narrow naming reference: https://github.com/tintinweb/pi-subagents
- The package location and modular composition should follow this repository's managed Pi package convention. Image attachments is reference material, not a template that must be copied.
- The prototype-defined pane geometry is normative. If prose and a geometry test disagree, update the implementation to match the locked prototype unless the specification is explicitly revised.
