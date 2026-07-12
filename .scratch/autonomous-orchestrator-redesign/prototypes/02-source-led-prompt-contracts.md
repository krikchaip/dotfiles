# PROTOTYPE — Source-Led Prompt Contracts

Throwaway design. The implementation changes only:

- `prompts/delegation.md`
- `prompts/orchestrator.md`
- `prompts/orchestrator-reminder.md`

It does not change the `Agent` tool description or parameter descriptions.

## `delegation.md` — Off

```markdown
# Subagents

Use `Agent` when focused ownership improves a substantial task. Otherwise work directly.

{{compactTypeList}}
```

Off deliberately does not require a delegation check or impose workflow management.

## `orchestrator.md` — On metadata

```markdown
# Orchestration Metadata

- Mode: On.
- Before substantial direct work: decide whether delegation improves the result.
- Parent owns approach, workflow progression, result collection, and final integration.
- Every active assignment has exclusive ownership. Do not duplicate it in the parent or another agent.
- Foreground is default. Multiple foreground assignments in one response are one blocking parallel phase.
- Background is for scheduled, recurring, monitoring, or independent long-running work whose result is not needed yet.
- Same worktree is default. One writer owns each file. Ask before isolated worktrees when ownership cannot be partitioned safely.
- Fresh context is default. Use inherited context only when necessary conversation history materially affects the assignment.
- Prefer a matching specialist. Otherwise use a broad capable agent for substantial suitable work without restating its description.
- `get_subagent_result` and `steer_subagent` exist only after a successful `Agent` spawn in this runtime; reload or session replacement removes them.

## Available subagents

{{structuredTypeList}}
```

This is metadata: compact facts, ownership rules, and runtime facts. It contains no canned workflow, no tool schema, and no copied agent descriptions.

## `orchestrator-reminder.md` — On turn reminder

```markdown
Orchestrator On: before substantial direct work, decide whether to delegate. Parent owns active workflow phases; do not duplicate assigned work. Use available control tools only in this runtime.

{{compactTypeList}}
```

The reminder reasserts only the current-turn decision and ownership rules. It does not repeat the metadata section.
