# Agent Interface

Type: grilling
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model): parent agent and sub-agent name actors; main quest and side quest name tasks.

## Question

What exact public `Agent` tool request and response contract must `side-quests` guarantee for Claude Code-style compatibility with `tintinweb/pi-subagents`, using an asynchronous side-quest model where the parent session continues immediately?

## Comments

- Tool name: `Agent`.
- Include required `prompt` for task instructions and required `description` for a short task label.
- Include optional `subagent_type`, `resume`, `inherit_context`, and `interactive`.
- Child session file path is the canonical sub-agent session identifier. Launch acknowledgment returns it; `resume` accepts it, adapting `pi-interactive-subagents` session-path mechanics into the tintinweb-style `Agent` interface. No separate opaque agent ID.
- Tool permissions, skill selection, and skill preloading belong only in agent-definition frontmatter; the `Agent` request has no `tools` or `skills` parameter.
- `subagent_type`, `inherit_context`, and `interactive` configure only new launches; resume rejects them.
- Exclude per-call `model`, `thinking`, `max_turns`, and `run_in_background`; model and thinking belong in agent frontmatter, pane users can cancel agents directly, and MVP `Agent` is always asynchronous.
- Exclude `isolated`, `isolation`, worktree support, `systemPrompt`, and `cwd` from the MVP tool contract.
- Domain model: the **parent agent** performs the **main quest**. Each **sub-agent** performs a coherent **side quest** in a persistent child session.
- Runtime mechanics come from `pi-interactive-subagents`; the public interface and selected features come from `tintinweb/pi-subagents`.
- MVP `Agent` launches sub-agents asynchronously so the parent agent can continue the main quest without waiting. Synchronous child-process waiting and communication are feasible but deferred to the backlog.
- A sub-agent returns its completed side-quest handoff to the parent agent. Whether that handoff embeds the full transcript, the final answer, or a transcript reference remains open.
- “Parent agent” and “sub-agent” name actors. “Main quest” and “side quest” name tasks and must not be used as agent or session synonyms. Runtime status, errors, results, and user-facing handoffs use `Agent`, `subagent`, or the configured agent name.

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

`prompt` and `description` are always required and non-empty, including when resuming. `description` is a short, descriptive task label supplied by the parent agent, preferably two to six words; it labels the pane and parent status UI. Every other field is optional. `resume` accepts the canonical child session-file path returned by an earlier invocation; there is no separate agent ID. `DynamicAgentType` is a registration-time enum containing the reserved `general-purpose` value plus every valid resolved non-general-purpose agent name. Omitted `subagent_type` and explicit `general-purpose` select the same standard parent clone, including any resolved `general-purpose.md` customization. There is no `"default"` enum value. Agent-definition changes become visible to the schema after extension reload. The parameter descriptions for `subagent_type`, `inherit_context`, and `interactive` must identify them as new-launch-only fields. The `subagent_type` description also says omission is the normal general-purpose form. The `inherit_context` description explains that `false` provides a fresh, parent-unbiased context for independent or adversarial work. The `interactive` description explains the initial pane-mode choice.

For a new launch, `prompt` is appended as a normal user-role message after any parent conversation copied by `inherit_context`. With fresh context, it is the child's first conversation message. The launch prompt is not a custom message.

When `resume` is present, `prompt` is the continuation message and `description` is the new task/status label, corresponding to HazAT's `message` and `name`. Reject the whole call when `subagent_type`, `inherit_context`, or `interactive` is present because the persisted session already owns its identity, resolved runtime configuration, conversation choice, and lifecycle. Parent system-prompt guidance must tell the model that these three fields apply only to new launches and must be omitted on resume. Keep that rule out of the short `Agent` tool description.

Every invocation is asynchronous. A new launch returns only after the child Pi pane has started and its session file exists. Every `Agent.resume` prompt is delivered as a persisted custom message, never as a normal user-role message. For a tracked live session, resume reuses that process: an idle child receives the custom message immediately and starts a turn, while an active child receives the custom message as `steer` after its current tool batch without aborting. If one `ask_parent` request is pending, the custom message carries its correlation and clears that request only after acceptance. For a stopped session, resume starts a new focus-preserving pane against the persisted session file and injects the custom message as its first continuation while resolving any pending request. Never start a duplicate process for a live path. The model-visible acknowledgement distinguishes launch, live continuation, and reopened resume and includes the canonical session path. Structured tool details expose the same operation, running status, and session path. No `run_in_background` switch exists.

Completion arrives later as a parent-session notification and wakes the parent model. A successful handoff contains the child’s final assistant response and canonical session path. It does not inject the full child transcript. An exhausted provider or agent-loop error terminates an autonomous child and sends the underlying error plus retry/resume guidance to the parent. The same turn-scoped error stays local when an interactive child process remains healthy: keep its pane open, return it to waiting, and do not wake the parent. A fatal or nonzero process exit is terminal in either lifecycle and includes the child's current-run final assistant response when available, otherwise a fallback diagnostic; never present an earlier response as the failed run's usable result. Add a distinct `closed` terminal outcome when a tracked tmux pane disappears without a trusted completion, cancellation, terminal error, or expected-parent-shutdown marker. It reports that the pane closed before completion, includes the final assistant response when available plus the session path, explicitly states when an unanswered `ask_parent` request remains saved, and never claims completion or user intent. A parent-widget close action writes a trusted user-cancellation marker before removing the selected pane, so it reports cancellation rather than `closed`. Every terminal handoff includes the same session path when one exists. Exact lifecycle transitions and presentation wording remain delegated to the lifecycle/status ticket.

Model-facing `Agent` guidance must distinguish actors from tasks: the parent agent performs the main quest, and each sub-agent performs a side quest. It must also identify `subagent_type`, `inherit_context`, and `interactive` as new-launch-only parameters that are omitted on resume. It must not use “main quest” or “side quest” as an agent or session synonym. Runtime statuses, errors, results, and user-facing handoffs use `Agent`, `subagent`, or the configured agent name.

MVP deliberately omits per-call `tools`, `skills`, `model`, `thinking`, `max_turns`, `run_in_background`, `isolated`, `isolation`, `systemPrompt`, and `cwd`. Synchronous execution and non-Pi runtimes remain outside the contract.
