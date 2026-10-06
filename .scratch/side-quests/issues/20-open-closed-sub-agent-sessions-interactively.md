# 20: Open closed sub-agent sessions interactively

Type: task

**Status:** deferred

**What to discuss later:** Add a human-only surface for opening a stopped autonomous sub-agent session as interactive. Decide whether this belongs in `/side-quests`, a separate command, or another explicit user flow; how the human selects a retained session safely; and how it interacts with canonical paths, human-friendly references, pending requests, duplicate-process prevention, and focus preservation. `Agent.resume` must remain unable to change lifecycle, and closed autonomous sessions have no interactive reopen surface until this feature is specified.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
