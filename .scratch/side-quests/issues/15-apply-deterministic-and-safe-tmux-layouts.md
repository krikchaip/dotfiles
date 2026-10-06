# 15: Apply deterministic and safe tmux layouts

Type: task

**Status:** ready-for-agent

**What to build:** Replace incidental tmux geometry with the locked binary and ternary layout policy. Recompute exact geometry from the full pane set while preserving stable pane identities, every pane process, parent-pane focus, and safe fallback when dimensions are impossible.

**Blocked by:** 12. Deliver the complete day-to-day MVP.

- [ ] Load `binary` or `ternary` policy at startup and reload, default to binary, and warn once when invalid configuration falls back.
- [ ] Implement one arity-based geometry interface whose results match the executable pane-layout prototype for all completed and partial levels.
- [ ] Preserve locked landscape and portrait ordering, geometric transposition, split orientation, terminal-cell aspect ratio, and binary and ternary remainder placement.
- [ ] Assign existing managed and unmanaged panes to canonical slots by stable pane identity rather than prior geometry.
- [ ] Recompute on managed start and stop, reload adoption, and detected window resize; leave a manual split unchanged until the next managed reflow trigger.
- [ ] Preserve every unmanaged pane and process, and remove the shared window after the last managed pane only when no unmanaged pane remains.
- [ ] Preserve the current valid arrangement and warn once per size/count state when tmux cannot represent the requested geometry; retry only after state changes.
- [ ] Keep launch, reopen, reflow, and resize detached and focus-preserving.
- [ ] Verify pure geometry against the prototype oracle and E2E-demo exact tmux rectangles, stable IDs, manual panes, process preservation, growth, shrink, resize, impossible sizes, and final-window cleanup.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
