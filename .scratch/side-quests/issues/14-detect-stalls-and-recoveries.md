# 14: Detect stalls and recoveries

Type: task

**Status:** ready-for-agent

**What to build:** Add liveness monitoring that distinguishes frozen child infrastructure from long valid work. Parent and child activity remain visible through the existing widgets. Autonomous stall and recovery events wake the parent agent once per transition; interactive stall and recovery remain local to the widget.

**Blocked by:** 12. Deliver the complete day-to-day MVP.

- [ ] Have each child atomically replace a small schema-versioned activity snapshot with monotonic sequence, event and heartbeat times, phase, active scope, tool details, lifecycle, and pending-parent state.
- [ ] Throttle streaming and tool updates while writing lifecycle, takeover, and request-state transitions immediately.
- [ ] Poll snapshots and canonical pane IDs once per second without file watchers or server-global tmux hooks.
- [ ] Mark a child stalled only after 60 seconds of missing, invalid, mismatched, or stale-heartbeat state.
- [ ] Keep long-running work healthy while heartbeats remain current; do not add a task-duration or transcript-inactivity timeout.
- [ ] Render stalled state without replacing independent lifecycle or pending-reply state.
- [ ] Deliver one persisted autonomous stall event and one recovery event for each transition, using stable event IDs.
- [ ] Keep interactive stall and recovery widget-only without starting a parent model turn.
- [ ] E2E-demo initial snapshot delay, stale heartbeat, healthy long work, autonomous recovery, repeated stall cycles, interactive stall, and no duplicate wakes.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
