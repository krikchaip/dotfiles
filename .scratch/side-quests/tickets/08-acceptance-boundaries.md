# Verification and Acceptance Boundaries

Type: decision
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model): parent agent and sub-agent name actors; main quest and side quest name tasks.

## Question

What evidence is required before the `side-quests` specification or implementation can be accepted?

## Answer

Acceptance requires all automated checks plus real Pi-in-tmux E2E coverage. Unit-only or mocked-tmux evidence is insufficient.

### Contract checks

- Outside tmux: one startup warning, no tools, commands, timers, or UI.
- `Agent` exposes only the resolved schema. Its parameter descriptions and system-prompt guidance identify `subagent_type`, `inherit_context`, and `interactive` as new-launch-only, and runtime validation rejects any resume containing them. It also rejects unknown fields, names, resume paths, models, tools, and skills.
- Project definitions override global definitions; malformed or disabled project definitions fail closed.
- Child capability policy always enables `ask_parent`, always denies every spawning tool, and never broadens after takeover or resume. Autonomous children also activate `subagent_done`; permanent promotion removes its schema, description, prompt snippet, and tool-specific system Guidelines from model context.
- Sub-agent session files stay outside Pi's normal session tree and do not appear in `/resume`.

### Real TUI and tmux checks

- Launch one child, then enough children to exercise binary and ternary rows, leftovers, landscape/portrait transposition, narrow windows, resize, completion, cancellation, manual pane closure, and resume.
- Assert exact pane rectangles from `tmux list-panes`, stable canonical pane IDs, deterministic reflow, and unchanged parent-pane focus.
- Assert the first child description becomes the shared window title. A later detached launch or resume keeps the selected pane's title. Side Quests navigation refreshes the title immediately, direct tmux pane selection refreshes it within one poll, and a selected child's accepted continuation refreshes it to the new description. Selecting an unmanaged pane restores the active native tmux automatic name. Closing the selected pane follows the next tmux-selected pane, while closing the sole pane destroys the window.
- Verify title normalization with whitespace, control characters, ordinary Unicode, tmux format syntax, descriptions longer than 48 display cells, and input that becomes empty. Verify the title is literal, safe, and display-cell bounded.
- Verify an explicit `rename-window`, disabled `automatic-rename`, or changed window-local `automatic-rename-format` permanently transfers title ownership to the user. Launch, resume, focus changes, child closure, and parent `/reload` must preserve that title exactly until window destruction. A title-update failure warns once, retries later, and does not block child lifecycle work.
- Inspect screenshots for the restrained parent widget, bordered child identity box, `HH:MM:SS` elapsed time, parent `reply needed` and child `reply pending` states alongside active and idle activity, exact two-cell outer padding and inter-column gaps, vertically aligned parent column starts, selected-row state, key hints from Pi's effective bindings, clipping, wrapping, and stale rows. Assert active-theme semantic colors: `muted` frames, bold `accent` titles and identities, `dim` elapsed time, `accent` starting/selection, `success` active, `muted` waiting/lifecycle, `error` stalled, and `warning` pending-reply states.
- Verify both `Shift+Up` and `/side-quests` enter parent navigation, confirm performs a pane jump, close requires confirmation, and no key is broadcast. After confirmed deletion with survivors, verify navigation stays focused on the nearest row and accepts another close action without re-entry; after final deletion, verify navigation and the widget close. Verify `Shift+Up` in a child focuses the canonical parent pane. Verify child interruption only from that child's pane through Pi's effective `app.interrupt` action.

### Lifecycle and messaging checks

- An autonomous child closes only after `subagent_done` supplies an explicit side-quest completion declaration, even with an unanswered parent request. A normal autonomous or interactive model turn end keeps its pane open and does not start an automatic continuation. After creation, only an accepted non-command prompt from the live child terminal permanently promotes lifecycle; `Agent.resume`, ordinary continuation, commands, and programmatic messages do not. Interactive lifecycle never demotes.
- `subagent_done` has exactly one required non-empty `result`, rejects additional fields, returns `terminate: true`, and is called exactly once and alone after work and validation. Its description, prompt snippet, and system Guidelines make this contract explicit. No other tool can authorize successful session shutdown; another tool's `terminate: true` leaves the child open.
- `/subagent-done` exists in both lifecycles, survives reload or reopen, accepts no arguments, and refuses active turns. It does not promote an autonomous child. It sends one hidden completion message with only `subagent_done` active. Success delivers the exact result, closes the pane, and renders the saved tool call as one complete `WRAP UP` banner with no duplicate result slot. Abort, error, or a turn without the tool keeps the pane open, restores prior tools, warns once, and does not retry.
- A new launch stores `Agent.prompt` as a normal user-role message. Every `Agent.resume` prompt is a persisted custom message, including immediate idle delivery, active `steer` delivery after the current tool batch, and the first continuation after reopen.
- `ask_parent` returns without terminating the child turn or shutting down the session, permits sibling tool calls, rejects another request while one is pending, survives pane close and reload, accepts one response, and never promotes lifecycle. A `closed` handoff explicitly states when its unanswered request remains saved.
- Autonomous exhausted provider/agent-loop errors outside a human command completion turn produce one terminal failed parent event. A command completion error stays local and restores tools. Recoverable errors in a healthy interactive child remain pane-local, return its row to `waiting`, permit retry, and produce no parent event. Fatal or nonzero process exits in either lifecycle produce one failed event with current-run response extraction and no stale-response substitution. Completion, cancellation, unmarked closure, stall, recovery, and child-pane interruption each produce the correct single parent event or lifecycle-specific widget-only transition.
- Parent quit, session replacement, abrupt death, broken reload, and tmux-window deletion leave no child process. Retained sessions remain resumable where specified.
- `/reload` adopts live children, restores layout/widget state, and delivers events written during the handoff once.

### Engineering checks

- Run formatter, typecheck, lint, unit tests, integration tests, and the pane-layout prototype suite with no failures or flakes.
- Run the repository's Pi extension E2E procedure in an isolated tmux server/context. Save command output, pane geometry, and screenshots as review evidence.
- Test failures, visual defects, focus theft, leaked processes, duplicate messages, or mutation of unrelated tmux panes block acceptance.