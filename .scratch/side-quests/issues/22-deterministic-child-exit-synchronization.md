# 22: Deterministic child-exit synchronization

Type: task

**Status:** deferred

**What to discuss later:** Reopening a stopped child currently waits for tmux pane removal and then uses a fixed 250 ms cleanup delay before it starts a replacement Pi process. Replace this timing-based approach with a per-run completion signal after the Pi process actually exits, such as a unique `tmux wait-for` channel signaled by a child-process wrapper. Keep a bounded timeout and prove that stale signals cannot unlock a later run. This is not required for the MVP.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
