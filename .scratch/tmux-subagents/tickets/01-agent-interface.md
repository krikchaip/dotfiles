# Agent Interface

Type: grilling
Status: resolved

## Question

What exact public `Agent` tool request and response contract must `side-quests` guarantee for Claude Code-style compatibility with `tintinweb/pi-subagents`, using an asynchronous side-quest model where the parent session continues immediately?

## Comments

- Tool name: `Agent`.
- Include required `prompt` for task instructions and required `description` for a short task label.
- Include optional `subagent_type`, `resume`, `inherit_context`, and `interactive`.
- Child session file path is the canonical side-quest identifier. Launch acknowledgment returns it; `resume` accepts it, adapting `pi-interactive-subagents` session-path mechanics into the tintinweb-style `Agent` interface. No separate opaque agent ID.
- Tool permissions, skill selection, and skill preloading belong only in agent-definition frontmatter; the `Agent` request has no `tools` or `skills` parameter.
- `interactive` behavior remains open.
- Exclude per-call `model`, `thinking`, `max_turns`, and `run_in_background`; model and thinking belong in agent frontmatter, pane users can cancel agents directly, and MVP `Agent` is always asynchronous.
- Exclude `isolated`, `isolation`, worktree support, `systemPrompt`, and `cwd` from the MVP tool contract.
- Domain model: the parent session is the **main quest**; each persistent child session is a **side quest** exploring related or unrelated work.
- Runtime mechanics come from `pi-interactive-subagents`; the public interface and selected features come from `tintinweb/pi-subagents`.
- MVP `Agent` launches side quests asynchronously so the main quest never waits. Synchronous child-process waiting and communication are feasible but deferred to the backlog.
- Side-quest completion returns a handoff to the main quest. Whether that handoff embeds the full transcript, the final answer, or a transcript reference remains open.
- “Side quest” is model-facing explanatory language only. Runtime status, errors, results, and user-facing handoffs use `Agent`, `subagent`, or the configured agent name.

## Answer

Register exactly one public tool named `Agent`.

Request schema:

```ts
{
  prompt: string;
  description: string;
  subagent_type?: DynamicAgentType;
  resume?: string;
  inherit_context?: boolean;
  interactive?: boolean;
}
```

`prompt` and `description` are always required and non-empty, including when resuming. `description` is a short, descriptive task label supplied by the parent agent, preferably two to six words; it labels the pane and parent status UI. Every other field is optional. `resume` accepts the canonical child session-file path returned by an earlier invocation; there is no separate agent ID. `DynamicAgentType` is a registration-time enum containing every resolved discovered agent name. `subagent_type` selects one of those names; omission selects the general-purpose parent-cloned agent. There is no explicit `"default"` enum value. Its parameter description must tell the model to omit it for general-purpose use. Agent-definition changes become visible to the schema after extension reload. `inherit_context` copies the parent conversation and defaults to `true`; its parameter description must explain that `false` provides a fresh, parent-unbiased context for independent or adversarial work. `interactive` exposes the initial pane-mode choice whose merge and lifecycle rules belong to its dedicated specification ticket.

Every invocation is asynchronous. The tool call returns only after the child Pi pane has started and its session file exists. Its model-visible launch acknowledgement distinguishes launch from resume and includes the canonical session path. Structured tool details expose the same operation, running status, and session path. No `run_in_background` switch exists.

Completion arrives later as a parent-session notification and wakes the parent model. A successful handoff contains the child’s final assistant response and canonical session path. It does not inject the full child transcript. Preserve HazAT's failure extraction behavior: a nonzero exit includes the child's final assistant response when available, otherwise a fallback diagnostic; a provider or agent-loop error reports the underlying error and retry/resume guidance instead of presenting an earlier assistant message as a usable result. Add a distinct `closed` terminal outcome when a tracked tmux pane disappears without a trusted completion, help, error, or expected-parent-shutdown marker. It reports that the pane closed before completion, includes the final assistant response when available plus the session path, and never claims completion or user intent. A parent-widget close action writes a trusted user-cancellation marker before removing the selected pane, so it reports cancellation rather than `closed`. Every terminal handoff includes the same session path when one exists. Exact lifecycle transitions and presentation wording remain delegated to the lifecycle/status ticket.

“Main quest” and “side quest” may appear in the model-facing `Agent` description or minimal system guidelines to explain delegation. They must not appear in runtime statuses, errors, results, or user-facing handoffs.

MVP deliberately omits per-call `tools`, `skills`, `model`, `thinking`, `max_turns`, `run_in_background`, `isolated`, `isolation`, `systemPrompt`, and `cwd`. Synchronous execution and non-Pi runtimes remain outside the contract.
