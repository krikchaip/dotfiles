# Verification and Acceptance Boundaries

Type: decision
Status: resolved

## Question

What evidence is required before the `side-quests` specification or implementation can be accepted?

## Answer

Acceptance requires all automated checks plus real Pi-in-tmux E2E coverage. Unit-only or mocked-tmux evidence is insufficient.

### Contract checks

- Outside tmux: one startup warning, no tools, commands, timers, or UI.
- `Agent` exposes only the resolved schema and rejects unknown fields, names, resume paths, models, tools, and skills.
- Project definitions override global definitions; malformed or disabled project definitions fail closed.
- Child policy always enables `ask_parent`, always denies every spawning tool, and never broadens after takeover or resume.
- Side-quest files stay outside Pi's normal session tree and do not appear in `/resume`.

### Real TUI and tmux checks

- Launch one child, then enough children to exercise binary and ternary rows, leftovers, landscape/portrait transposition, narrow windows, resize, completion, cancellation, manual pane closure, and resume.
- Assert exact pane rectangles from `tmux list-panes`, stable canonical pane IDs, deterministic reflow, and unchanged main-quest focus.
- Inspect screenshots for the restrained parent widget, bordered child identity box, `HH:MM:SS` elapsed time, parent `reply needed` and child `reply pending` states alongside active and idle activity, exact two-cell outer padding and inter-column gaps, vertically aligned parent column starts, selected-row state, key hints from Pi's effective bindings, clipping, wrapping, and stale rows.
- Verify `/side-quests` navigation, pane jump, confirmed close, and no broadcast keypresses. Verify child interruption only from that child's pane through Pi's effective `app.interrupt` action.

### Lifecycle and messaging checks

- Autonomous completion closes its pane even with an unanswered parent request; interactive completion keeps it; only an accepted interactive prompt permanently promotes lifecycle.
- A new launch stores `Agent.prompt` as a normal user-role message. Every `Agent.resume` prompt is a persisted custom message, including immediate idle delivery, active `steer` delivery after the current tool batch, and the first continuation after reopen.
- `ask_parent` returns without terminating the child turn, permits sibling tool calls, rejects another request while one is pending, survives pane close and reload, accepts one response, and never promotes lifecycle.
- Completion, failure, cancellation, unmarked closure, stall, recovery, and child-pane interruption each produce the correct single parent event and widget transition.
- Parent quit, session replacement, abrupt death, broken reload, and tmux-window deletion leave no child process. Retained sessions remain resumable where specified.
- `/reload` adopts live children, restores layout/widget state, and delivers events written during the handoff once.

### Engineering checks

- Run formatter, typecheck, lint, unit tests, integration tests, and the pane-layout prototype suite with no failures or flakes.
- Run the repository's Pi extension E2E procedure in an isolated tmux server/context. Save command output, pane geometry, and screenshots as review evidence.
- Test failures, visual defects, focus theft, leaked processes, duplicate messages, or mutation of unrelated tmux panes block acceptance.