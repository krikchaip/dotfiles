# Pane Layout Modes

Type: grilling
Status: resolved

## Question

What exact named pane-layout modes and deterministic geometry/reflow rules must `side-quests` apply for every active pane count, including split orientation, pane ordering, agent start/stop behavior, and terminal-size edge cases?

## Comments

- Layout applies only inside the parent session's shared subagent window.
- Reapply the selected layout whenever a subagent pane starts or stops.
- Name recursive split mode `binary`; `dual` incorrectly suggests a two-pane limit.
- Named modes are `binary` recursive splitting and `ternary` thirds.
- Preserve deterministic pane placement rather than relying on tmux's incidental reflow.
- Both modes are locked by the single executable oracle `../prototypes/pane_layout_prototype.py`, selected with `--mode binary|ternary` and `--canvas landscape|portrait`.
- Both modes use the same breadth-first arity algorithm. `binary` has arity two; `ternary` has arity three.
- For `N` panes and arity `A`, let `P` be the greatest power of `A` not exceeding `N`, and let `E = N - P`.
- Build the completed `P`-pane base geometry by splitting every leaf into `A` shares at each tree depth along its longer rendered dimension. Account for terminal cells as twice as tall as wide: use side-by-side when `width >= 2 × height`; otherwise use stacked.
- Visit each partial-level target once and consume up to `A - 1` additions before moving to the next target. The retained left/top region holds all not-yet-consumed shares; every addition consumes one share at right/bottom.
- Preserve locked integer-remainder placement: `binary` assigns an odd leftover cell to right/bottom; `ternary` assigns one or two leftover cells to left/top.
- Recompute the entire canonical geometry for every `N`; do not incrementally preserve the prior pane tree.
- In landscape, number completed base slots row-major. Visit partial-level targets by rightmost column first, bottom-to-top, then move left. For eight slots this is `8 → 4 → 7 → 3 → 6 → 2 → 5 → 1`.
- Portrait is the geometric transpose: number completed base slots column-major. Visit partial-level targets by bottom row first, right-to-left, then move upward. This preserves the same conceptual eight-slot sequence.
- Number completed landscape base slots row-major. Visit targets by rightmost column first, bottom-to-top, then move left. Recompute global canonical geometry for every pane count.
- Portrait is the geometric transpose: number completed base slots column-major, visit targets by bottom row first and right-to-left, then move upward.
- Avoid ambiguous “horizontal split” terminology in the specification. Say `stacked` for a horizontal divider and `side-by-side` for a vertical divider.
- Users may manually split panes. Do not immediately undo or reflow manual splits.
- Recompute and reapply the configured layout after either plugin lifecycle event: a subagent pane starts or a managed subagent finishes.
- During reflow, count every pane in the shared window, including manually created panes, as an ordinary layout leaf. Preserve each pane process but replace any manual geometry.
- Shrinking recomputes the canonical geometry for `N - 1` panes; it is the exact reverse of canonical growth without depending on prior tmux geometry.
