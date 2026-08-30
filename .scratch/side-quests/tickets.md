# Tickets: Side Quests

These tickets build the tmux-only Pi `side-quests` extension specified in [spec.md](spec.md), using [map.md](map.md), the resolved wayfinder tickets, the pane-layout prototype, and the package README as decision sources.

**Domain terms:** Parent agent and sub-agent name actors. Main quest and side quest name tasks. A side quest is a meaningful, self-contained task with reviewable evidence, not a sub-agent, session, pane, file fetch, file read, basic lookup, or retrieval-only operation.

Work the **frontier**: any ticket whose blockers are all done. Tickets 3, 4, and 5 form the parallel frontier after the MVP.

## 1. Establish package architecture and verification loop

**Status:** done

**What to build:** Establish a working local Pi package foundation with a small declarative composition root, cohesive deep modules, and an executable verification loop. Complete this ticket with the user in the loop: agree on module interfaces, ownership invariants, and test seams before those decisions are locked. The independently demoable product behavior is safe startup: outside tmux, Side Quests warns exactly once and remains fully inert; inside tmux, parent and child roles load only their intended package surfaces without startup errors.

**Blocked by:** None — can start immediately.

- [x] Agree with the user on the deep module interfaces for agent policy, persistent state and mailboxes, tmux ownership and layout, parent coordination and event delivery, parent UI, and child lifecycle and activity.
- [x] Keep the package entrypoint declarative and keep parsing, persistence, process control, layout, polling, and rendering inside their owning modules.
- [x] Expose one normal parent extension entrypoint while keeping the child companion package-internal and explicitly loadable only by managed child processes.
- [x] Detect inert, parent, and child roles before any role-specific registration or resource startup.
- [x] Outside tmux, show exactly one warning and register no tool, command, hook-driven UI, timer, poller, or child resource.
- [x] Agree on test seams before writing tests: the complete installed Pi extension is primary; pure policy, storage validation, event identity, lifecycle, mailbox, and layout interfaces are supplemental seams.
- [x] Provide repeatable commands for formatting, typecheck, unit tests, pane-layout prototype checks, and isolated real Pi-in-tmux E2E tests.
- [x] Make the E2E harness apply chezmoi source, isolate Pi and tmux state, drive a real TUI through a PTY, fail closed on missing evidence, preserve readable logs, and clean all temporary processes and files.
- [x] Demonstrate supported and unsupported startup through the real harness with no lint, typecheck, test, or process-leak failure.

## 2. Deliver the complete day-to-day MVP

**Status:** done

**What to build:** Make Side Quests usable in daily work through one complete general-purpose delegation slice. The parent agent can launch concurrent Pi sub-agents asynchronously, monitor and control them through the complete parent and child UI, exchange correlated questions and continuations, use autonomous or interactive lifecycles, and receive truthful terminal results. Each sub-agent performs a complete side quest. Persist each child as a resumable managed Pi session and preserve parent-pane focus throughout.

**Blocked by:** 1. Establish package architecture and verification loop.

- [x] Register exactly one public `Agent` tool with the specified strict request schema, reserved `general-purpose` choice, asynchronous acknowledgements, and canonical session paths.
- [x] Launch only Pi, directly in detached panes of one shared sub-agent window, from the parent agent's invocation-time working directory without an intermediate shell or focus change.
- [x] Support concurrent new launches, live-idle continuation, live-active steering after the current tool batch, stopped-session reopen, and duplicate-process prevention.
- [x] Clone the parent runtime for the standard general-purpose child, copy context once by default, preserve a fresh-context option, hard-deny every spawning tool, and force-enable `ask_parent`.
- [x] Persist the session, resolved manifest, owner state, activity state, terminal state, and request/response mailboxes under the managed Side Quests storage root.
- [x] Support autonomous and initially interactive lifecycles, permanent promotion only through accepted direct terminal input after creation, no demotion, and no promotion from resume, incidental input, or programmatic input.
- [x] Use `subagent_done({ result })` as the only successful completion declaration for autonomous children. Remove it and all prompt metadata on promotion. Keep no-argument `/subagent-done` available in both lifecycles to start one hidden completion-only turn. Render the persisted tool call as the single `WRAP UP` banner.
- [x] Make `ask_parent` accept one correlated request, return without terminating the child turn, preserve sibling tool execution, reject a second pending request, wake the parent, and accept its matching answer only through `Agent.resume`.
- [x] Render the complete restrained parent widget and child identity widget with elapsed time, identity, task, lifecycle/activity, reply state, exact padding and column alignment, and task-first narrow-width truncation.
- [x] Implement `/side-quests` navigation with effective Pi selection bindings, stable child identity, explicit pane jump, scoped delete key hint, named confirmation, cancellation semantics, and no parent interrupt action.
- [x] Render collapsed and expanded parent results with effective `app.tools.expand` hints and clear completed, failed, cancelled, and closed outcomes.
- [x] Include the explicit `subagent_done.result` for success, current-run assistant output only as valid failure or closure diagnostics, the canonical session path, pending-request state where relevant, and no full transcript or stale-response substitution.
- [x] Keep interactive provider or agent-loop turn failures local while treating autonomous exhausted failures and fatal process exits as terminal according to the README.
- [x] Preserve unmanaged panes and use a safe basic tmux arrangement until the deterministic layout ticket replaces geometry policy.
- [x] E2E-demo explicit autonomous and command-driven completion, completion-tool removal on promotion, live and persisted tool-owned `WRAP UP` banners, failed command-turn recovery, terminal takeover, parent questions, continuation, reopen, navigation, closure outcomes, narrow widgets, focus, and retained sessions.

## 3. Configure general-purpose and named agents

**Status:** ready-for-human

**What to build:** Let users configure the standard general-purpose agent and any number of named agents through project and global Markdown definitions. Every launch starts from the current parent runtime and applies strict, validated overrides. The parent model receives the complete valid non-general-purpose agent catalog in Pi's `Guidelines` section, while every child's resolved capabilities remain fixed across continuation, takeover, reload, and reopen.

**Blocked by:** 2. Deliver the complete day-to-day MVP.

**Required discussion before implementation:** Revisit frontmatter omission and empty-value behavior with the user. Do not treat “left blank” as one case. Review each supported field across four distinct inputs: omitted key, YAML null such as `model:`, empty string such as `model: ""`, and an explicit empty collection such as `tools: []`. Also review an absent or empty Markdown body. Start from, but do not lock without that discussion, these current assumptions: omission inherits the parent-derived value or uses the documented context/lifecycle default; null and invalid empty strings make the winning definition malformed and fail closed; supported empty lists are valid explicit empty selections; and an empty Markdown body adds no child instructions.

- [ ] Record the agreed omission/null/empty-string/empty-list/body behavior for every supported frontmatter field before writing its resolver.
- [ ] Make omitted `subagent_type` and explicit `general-purpose` resolve to the same reserved standard identity.
- [ ] Without a winning `general-purpose.md`, use the unmodified parent clone.
- [ ] Apply supported frontmatter and Markdown-body overrides from a valid winning project or global `general-purpose.md`; allow its `description` to be absent.
- [ ] Make project general-purpose configuration shadow global configuration before validation.
- [ ] Reject omitted and explicit general-purpose launches when the winning file is malformed, with one path-specific warning and no fallback.
- [ ] Treat `enabled: false` in project or global general-purpose configuration as removal of customization, not removal of the standard agent; a project tombstone also shadows global customization.
- [ ] Discover non-general-purpose agents from only the specified project and global scopes with exact case-sensitive stems, project precedence, fail-closed malformed shadowing, and disabling tombstones.
- [ ] Make a named definition with only its required `description`, such as `security-review.md`, use the same parent-derived runtime baseline as uncustomized `general-purpose` while retaining its distinct named identity. Treat frontmatter `description` only as parent-agent selection guidance, not as sub-agent instructions; with no Markdown body, task behavior comes from `Agent.prompt`.
- [ ] Put every valid non-general-purpose canonical name and full whitespace-normalized description in the parent system prompt's `Guidelines` section; do not duplicate the catalog in the short tool description.
- [ ] Refresh the registration-time enum after reload so it always contains `general-purpose` plus every valid enabled non-general-purpose name.
- [ ] Resolve exact model, thinking, tool allowlist and denylist, lazy skills, preloaded skills, context, lifecycle, display name, and body instructions from the parent baseline.
- [ ] Reject unknown models, tools, and skills before pane or session creation; clamp valid thinking levels through Pi's native behavior.
- [ ] Permanently hard-deny spawning tools, force-enable `ask_parent`, and preserve resolved identity, context choice, lifecycle, capabilities, and prompt policy across resume. Reject `subagent_type`, `inherit_context`, and `interactive` on resume; only accepted direct terminal input can promote lifecycle after creation.
- [ ] Add table-driven policy tests for every supported field covering omission, YAML null, empty string, valid empty collection where applicable, valid value, and invalid type for both `general-purpose` and named definitions.
- [ ] E2E-demo a description-only named definition and prove that omitted runtime fields inherit the parent-derived baseline while the distinct identity and catalog description remain.
- [ ] E2E-demo a valid `general-purpose.md` with omitted optional fields and an absent or empty Markdown body; cover both omitted and explicit `general-purpose` launches.
- [ ] E2E-demo the agreed explicit-empty collection behavior for `tools`, `disallowed_tools`, `available_skills`, and `preload_skills`, observing the actual child prompt and tool surface rather than only parsed values.
- [ ] E2E-demo representative YAML-null and empty-string failures for both general-purpose and named winning files. Prove one path-specific warning, no pane or session creation, no fallback to a shadowed global definition or plain parent clone, and rejection of both omitted and explicit general-purpose launches when applicable.
- [ ] E2E-demo project-over-global behavior, `enabled: false` customization removal and named tombstones, a named restricted reviewer, Guidelines catalog refresh, immutable permissions after resume, and all final behaviors agreed during the frontmatter discussion.

## 4. Detect stalls and recoveries

**Status:** ready-for-agent

**What to build:** Add liveness monitoring that distinguishes frozen child infrastructure from long valid work. Parent and child activity remain visible through the existing widgets. Autonomous stall and recovery events wake the parent agent once per transition; interactive stall and recovery remain local to the widget.

**Blocked by:** 2. Deliver the complete day-to-day MVP.

- [ ] Have each child atomically replace a small schema-versioned activity snapshot with monotonic sequence, event and heartbeat times, phase, active scope, tool details, lifecycle, and pending-parent state.
- [ ] Throttle streaming and tool updates while writing lifecycle, takeover, and request-state transitions immediately.
- [ ] Poll snapshots and canonical pane IDs once per second without file watchers or server-global tmux hooks.
- [ ] Mark a child stalled only after 60 seconds of missing, invalid, mismatched, or stale-heartbeat state.
- [ ] Keep long-running work healthy while heartbeats remain current; do not add a task-duration or transcript-inactivity timeout.
- [ ] Render stalled state without replacing independent lifecycle or pending-reply state.
- [ ] Deliver one persisted autonomous stall event and one recovery event for each transition, using stable event IDs.
- [ ] Keep interactive stall and recovery widget-only without starting a parent model turn.
- [ ] E2E-demo initial snapshot delay, stale heartbeat, healthy long work, autonomous recovery, repeated stall cycles, interactive stall, and no duplicate wakes.

## 5. Apply deterministic and safe tmux layouts

**Status:** ready-for-agent

**What to build:** Replace incidental tmux geometry with the locked binary and ternary layout policy. Recompute exact geometry from the full pane set while preserving stable pane identities, every pane process, parent-pane focus, and safe fallback when dimensions are impossible.

**Blocked by:** 2. Deliver the complete day-to-day MVP.

- [ ] Load `binary` or `ternary` policy at startup and reload, default to binary, and warn once when invalid configuration falls back.
- [ ] Implement one arity-based geometry interface whose results match the executable pane-layout prototype for all completed and partial levels.
- [ ] Preserve locked landscape and portrait ordering, geometric transposition, split orientation, terminal-cell aspect ratio, and binary and ternary remainder placement.
- [ ] Assign existing managed and unmanaged panes to canonical slots by stable pane identity rather than prior geometry.
- [ ] Recompute on managed start and stop, reload adoption, and detected window resize; leave a manual split unchanged until the next managed reflow trigger.
- [ ] Preserve every unmanaged pane and process, and remove the shared window after the last managed pane only when no unmanaged pane remains.
- [ ] Preserve the current valid arrangement and warn once per size/count state when tmux cannot represent the requested geometry; retry only after state changes.
- [ ] Keep launch, reopen, reflow, and resize detached and focus-preserving.
- [ ] Verify pure geometry against the prototype oracle and E2E-demo exact tmux rectangles, stable IDs, manual panes, process preservation, growth, shrink, resize, impossible sizes, and final-window cleanup.

## 6. Survive reload, replacement, and owner loss

**Status:** ready-for-agent

**What to build:** Make every completed capability durable across normal reload and safe across parent replacement or loss. Reload adopts live children, widgets, layout, policy, requests, and terminal events without duplication. Every other parent teardown stops owned processes while retaining valid resumable sessions.

**Blocked by:** 3. Configure general-purpose and named agents; 4. Detect stalls and recoveries; 5. Apply deterministic and safe tmux layouts.

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

## 7. Complete full specification conformance

**Status:** ready-for-agent

**What to build:** Deliver the fully integrated Side Quests product. Audit every requirement against the specification, wayfinder map and resolved tickets, README, and executable layout oracle. Implement every remaining gap instead of deferring it, then produce complete automated and real Pi-in-tmux acceptance evidence.

**Blocked by:** 6. Survive reload, replacement, and owner loss.

- [ ] Build a traceable acceptance matrix covering every user story, implementation decision, testing decision, README behavior, and wayfinder amendment.
- [ ] Exercise every public `Agent` schema rule, agent-definition rule, permission invariant, lifecycle transition, mailbox state, terminal outcome, health transition, layout mode, UI state, reload path, teardown path, and storage-safety rule.
- [ ] Implement any missing behavior or evidence found by the audit; do not convert gaps into follow-up tickets or defer specified work.
- [ ] Inspect real normal-width and narrow-width screenshots for exact borders, padding, aligned columns, truncation, wrapping, selection, key hints, reply state, stale rows, and result expansion.
- [ ] Run formatter, typecheck, lint, unit tests, integration tests, prototype checks, package application checks, and isolated real Pi-in-tmux E2E tests with no failure or flake.
- [ ] Prove there is no focus theft, duplicate delivery, stale response, stale widget, leaked process, malformed geometry, unsafe resume, session-list pollution, or mutation of unrelated panes.
- [ ] Leave the specification, map amendments, resolved design tickets, README, package behavior, and test evidence consistent with each other.

## Backlog

### Open closed sub-agent sessions interactively

**Status:** deferred

**What to discuss later:** Add a human-only surface for opening a stopped autonomous sub-agent session as interactive. Decide whether this belongs in `/side-quests`, a separate command, or another explicit user flow; how the human selects a retained session safely; and how it interacts with canonical paths, human-friendly references, pending requests, duplicate-process prevention, and focus preservation. `Agent.resume` must remain unable to change lifecycle, and closed autonomous sessions have no interactive reopen surface until this feature is specified.

### Human-friendly sub-agent references

**Status:** deferred

**What to discuss later:** Let a human refer to a live sub-agent without copying a `session.jsonl` path or repeating its task description. Decide whether Side Quests should expose a stable short identifier, a current widget row number, or both. Define what stays valid after launch, completion, removal, sorting, reload, and reopen; how the parent model receives the reference; and how ambiguity is prevented when display names contain numbers. Do not make row position an implicit persistent identity.

### Deterministic child-exit synchronization

**Status:** deferred

**What to discuss later:** Reopening a stopped child currently waits for tmux pane removal and then uses a fixed 250 ms cleanup delay before it starts a replacement Pi process. Replace this timing-based approach with a per-run completion signal after the Pi process actually exits, such as a unique `tmux wait-for` channel signaled by a child-process wrapper. Keep a bounded timeout and prove that stale signals cannot unlock a later run. This is not required for the MVP.

## Comments

- Ticket 1 claimed. The composition root is approved. Parent and child each use a barrel `index.ts`; both surfaces are split into `parent/index.ts`, `parent/runtime.ts`, `parent/ui.ts`, and `child/index.ts`, `child/runtime.ts`, `child/ui.ts`. Storage stays as direct `store/*.ts` imports without a barrel. `agent-definitions/` owns definition discovery and immutable child capability resolution, and has one barrel `agent-definitions/index.ts` that encapsulates its internal parts. Tmux starts as one cohesive `tmux.ts` module; it alone runs tmux commands and identifies managed panes/windows through persisted canonical IDs and full owner IDs, never display names or pane geometry. `parent/runtime.ts` owns Pi registrations, polling, coordination, persistence/tmux calls, and parent event delivery. `parent/ui.ts` only renders and emits navigation intents; the runtime validates and applies them. The parent and child runtime/UI boundaries are provisionally approved and can be refined when concrete behavior exists. `child/runtime.ts` owns child tools, activity and lifecycle state, terminal-state writes, and dynamic child commands; `child/ui.ts` only renders its runtime-provided identity view. Each `store/` file is named for its storage type (for example, `manifest.ts`, `mailbox.ts`, `activity.ts`, and `terminal.ts`), with separate direct-import domain-operation utilities where needed. `store/` has no barrel. Testing follows a reverse pyramid: user-journey E2E tests are primary; integration tests are next; small focused unit tests cover low-cost deterministic logic such as pane layout. The otherwise inert unsupported-tmux path may register one `session_start` hook solely to show its one warning; it must register nothing else.
