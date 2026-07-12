# PROTOTYPE — Mode-Specific Prompt Contracts

Question: Can compact Off delegation and explicit On orchestration coexist without repeating `Agent` tool or parameter descriptions?

Throwaway discussion artifact. No extension source changes.

## Shared dynamic agent-list form

Keep this form verbatim in both main-agent prompt blocks:

```markdown
{{structuredTypeList}}
```

The runtime expands it from registered agent metadata. It is routing data, not an instruction to recreate an agent description in an assignment. No static agent list belongs in these prompt files.

## `delegation.md` — Off contract

```markdown
# Subagent Delegation

Delegation is available through the `Agent` tool. Use the available subagent descriptions as the routing table.

Delegate a separable, substantial investigation, implementation slice, review, or verification task when a listed type fits. Work directly when the target is already known, the work is tiny, the user requests an immediate action, or separation would add no value.

{{structuredTypeList}}

For every assignment:
- Give one agent non-overlapping ownership. Main agent does not duplicate active subagent work.
- Foreground is default. Multiple foreground `Agent` calls in one response are one blocking parallel phase.
- Use background only for scheduled/recurring work, monitoring, or independent long-running work whose result is not needed yet.
- Same worktree is default. One writer owns a file at a time. Ask user before isolated worktrees when safe ownership cannot be partitioned.
- Fresh context is default. Set `inherit_context` only when important conversation history is needed; say why in the assignment.
- State exact goal, relevant context, constraints, and expected output. Do not repeat a specialist description.

Example — known symbol lookup: read or grep directly. Example — independent source review: assign one read-only agent ownership of that review.
```

Off has no required pre-work delegation check. It may delegate autonomously when delegation helps.

## `orchestrator.md` — On contract

```markdown
# Subagent Orchestrator

Orchestrator mode is active. Before substantial direct work, decide whether delegation improves the result. Delegate suitable separable work; then manage its phases until the user request is complete.

{{structuredTypeList}}

Plan work as ownership-safe phases:
1. Settle approach and split independent slices.
2. Assign each slice once. Foreground assignments form a blocking parallel phase; do not duplicate their work.
3. Continue only independent main-agent work while a background assignment runs. Inspect foreground results before starting dependent work.
4. After a successful `Agent` spawn, use `get_subagent_result` to collect results and `steer_subagent` only to redirect active work when those tools are available in this runtime.

Routing and runtime rules:
- Use a listed specialist when it fits. Otherwise route substantial suitable work to a broad capable agent; do not restate its description.
- Foreground is default. Background is only for scheduled/recurring work, monitoring, or independent long-running work whose result is not needed yet.
- Same worktree is default. One writer owns a file at a time. Ask user before isolated worktrees when safe ownership cannot be partitioned.
- Fresh context is default. Use inherited context only when important conversation history changes the result.

Example — review then implementation: run independent read-only reviews together in foreground; collect results; assign one writer the implementation; inspect result; then assign focused verification if needed.
```

`orchestrator.md` states durable mode behavior. It does not describe `Agent` parameters or claim controls survive reload/session replacement.

## `orchestrator-reminder.md` — On-turn contract

```markdown
Orchestrator On for this turn. Before substantial direct work, make delegation check. Manage suitable delegated phases through completion. Do not duplicate active subagent work. Use control tools only when currently available.
```

Reminder repeats only turn-critical rules. It must stay short because it is injected once per eligible user turn.

## Contract split

| Concern | Home |
| --- | --- |
| Off delegation baseline | `delegation.md` |
| On requirement to check delegation and own workflow completion | `orchestrator.md` |
| Per-turn reassertion | `orchestrator-reminder.md` |
| Dynamic agent names/descriptions | `{{structuredTypeList}}` expansion |
| Runtime availability of result/steering controls | runtime metadata, referenced by On prompt and reminder |
| `Agent` tool and parameter descriptions | unchanged built-in tool description |

## Concrete workflows

- Off — user asks to rename known file. Main agent edits directly. User asks for a broad source audit. Main agent assigns audit to best read-only specialist, then uses result.
- On — user asks for a multi-context feature. Main agent checks delegation before direct work, assigns independent architecture and source investigations in one foreground phase, collects results, assigns one writer, then collects and verifies writer result.
- On — user asks for a task requiring prior conversation decision. Main agent gives relevant conversation context only to agent needing it; all other assignments use fresh context.

## Questions for human reaction

1. Is `orchestrator.md` right place for full durable policy, while reminder carries only short per-turn pressure?
2. Should Off retain all shared worktree/context/ownership rules, or should Off shrink further to delegation selection plus no-duplication?
