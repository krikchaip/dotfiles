# Agent Configuration

Type: grilling
Status: resolved

## Question

Where are agent definitions discovered, how are same-name definitions resolved, what defaults apply when `subagent_type` is omitted, and how does definition frontmatter determine the child Pi session's final capabilities?

## Comments

- Preserve the resolved `Agent` request schema from `01-agent-interface.md`.
- Launch Pi child sessions only.
- Model, thinking, tool permissions, skill selection, and skill preloading belong in agent-definition frontmatter, not per-call tool parameters. The `Agent` request has no `tools` or `skills` parameter.
- Canonical skill frontmatter is `available_skills: true | false | [name, ...]` plus `preload_skills: [name, ...]`. Do not accept `skills` as an alias or fallback.
- `available_skills` controls the lazy-load catalog. Omission inherits the parent's current catalog, `true` selects every normally model-invocable child-discovered skill, `false` selects none, and a name list selects that exact discovered-skill set. A named list explicitly overrides a selected skill's `disable-model-invocation` flag; broad `true` does not. Explicit selection may include a discovered skill hidden in the parent. Unknown names are hard errors.
- `preload_skills` resolves independently from the child-discovered skill registry, may explicitly load skills marked `disable-model-invocation`, and loads full skill instructions into the child system prompt. If a preloaded skill is also selected by `available_skills`, omit it from `<available_skills>` because it is already loaded. Unknown names are hard errors.
- If the resolved tool set lacks `read`, preserve Pi's behavior by omitting the available-skills catalog while still injecting `preload_skills`. When the omitted catalog would have been non-empty, emit a non-fatal launch warning.
- Agent permissions must cover built-in, extension, and custom tools by exact registered tool name.
- Agent definitions have no extension-loading frontmatter. Every child inherits the parent's loaded extension set so its pane retains the parent's commands, hooks, and interactive UX. The `side-quests` parent-orchestration entrypoint remains inert in child sessions, while a child-only companion entrypoint from the same package records activity and handles resolved lifecycle behavior. Neither entrypoint may register `Agent` or another subagent-spawning tool in a child.
- Omitted `tools` inherits the parent's current enabled-tool set. Present `tools` replaces that set with an exact allowlist drawn from the child session's registered tools; it may enable a registered tool disabled in the parent. Apply `disallowed_tools` and the hard subagent-spawning denylist afterward. Unknown names are hard errors.
- Interactive launch or takeover does not restore the parent's enabled-tool set. A subagent retains its resolved subagent tool policy permanently; interactivity changes who drives the session, not what capabilities the session has.
- Resolve discovery paths and precedence before permission merge behavior.
- Discover named definitions only from `<cwd>/.pi/agents/*.md` and `$PI_CODING_AGENT_DIR/agents/*.md` (default `~/.pi/agent/agents/*.md`). Project definitions override same-name global definitions.
- Do not scan `.agents/agents/` and do not ship bundled agent definitions. Users create every named definition.
- Agent files are shared with other plugins. Ignore and do not consume unknown frontmatter fields; do not warn, reject the agent, or interpret unsupported pi-subagents fields as aliases.
- Missing `subagent_type` selects the general-purpose default agent cloned from the parent. There is no explicit `"default"` value, and `default.md` does not define the default agent. The tool parameter description tells the model to omit `subagent_type` for general-purpose use.
- The default agent clones the parent's current model, thinking level, system prompt, working directory, enabled tools, loaded extensions, and skills. Conversation inheritance defaults to enabled unless frontmatter or the `Agent` call sets `inherit_context: false`.
- Subagent sessions never receive `Agent` or any other subagent-spawning tool. This hard prohibition overrides parent cloning, named-agent frontmatter, and future configuration.
- Expose discovered agent names and full frontmatter descriptions in the parent system prompt. Normalize whitespace only; do not truncate descriptions.
- Keep the `Agent` tool description short; do not duplicate the agent catalog there.
- Define `Agent.subagent_type` as a dynamic enum containing every resolved discovered agent name. Build the enum when the extension registers the tool; omission selects the default agent.
- Named agents clone the current parent session configuration as their baseline. Any frontmatter field omitted by the named definition inherits the corresponding parent value rather than resetting to Pi defaults.
- Agent definitions have no `prompt_mode`. Preserve Pi's native prompt construction and section order for the resolved child configuration. Append preloaded skill content after Pi's native prompt, then append the agent definition's Markdown body last.
- Consume one pane-mode field, `interactive: boolean`, in both named-agent frontmatter and the `Agent` request. `true` keeps the pane open after a completed turn; `false` or omission starts autonomously and closes after completion. A per-call value overrides frontmatter, and submitting a non-command prompt from the child terminal permanently changes the session to interactive. Editing, typing, pasting, navigation, extension commands, and extension-injected messages do not. Do not consume `auto-exit`; auto-exit is derived lifecycle behavior rather than configuration.
- Consume `inherit_context: boolean` in named-agent frontmatter as the default for copying the parent conversation. A per-call `Agent.inherit_context` value overrides it; total omission defaults to `true`. Set it false for a fresh, parent-unbiased context such as an adversarial review, second opinion, or unrelated task. Context is copied once at launch; later parent turns are not synchronized. Do not consume Hazat's `session-mode`; lineage and session association are separate from conversation copying.
- Do not consume `cwd` in MVP frontmatter. Every new child starts in the parent session's current working directory at invocation; `Agent` also has no per-call `cwd`. Pass that directory explicitly to tmux pane creation rather than relying on tmux's focused-pane directory.
- Do not consume `max_turns` in MVP frontmatter. Autonomous runs stop through normal model completion or direct pane cancellation; no turn-count limiter or graceful-turn subsystem is included.
- Consume optional non-empty `display_name` as a presentation-only agent label. The filename remains the canonical identity for discovery, shadowing, `subagent_type`, ownership, and resume. Required frontmatter `description` explains the role in the parent catalog, while required per-call `Agent.description` supplies the short task label. Widget and pane presentation use `display_name` when present and otherwise fall back to the filename stem.
- Consume `enabled: false` as a project-level tombstone for disabling a same-name global agent. Resolve precedence first, then omit the disabled name from the parent catalog and `Agent.subagent_type` enum. A disabled tombstone needs no description or prompt body. Do not provide a hidden-but-directly-invokable state such as `disable-model-invocation`.
- A present `model` must be an exact `provider/model-id` pair found in Pi's model registry. Do not accept bare IDs, aliases, globs, fuzzy matching, or tintinweb's tolerant cross-provider resolver. Invalid explicit models hard-error instead of falling back to the parent. Omission inherits the parent's current model.
- `thinking` accepts Pi's levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Omission inherits the parent's current level; invalid values hard-error. A valid level unsupported by the resolved model is clamped through Pi's native capability logic. Explicit `thinking` overrides the model's default thinking level.
- Do not consume tintinweb's `memory` frontmatter or implement cross-session agent memory in MVP. Continuity uses explicit session-path resume; stable knowledge belongs in the agent body or selected skills.
- Every MVP side quest uses a persistent Pi session file. Do not consume `persist_session`, `output_transcript`, or `session_dir`, and do not create a second transcript format. Pi supports `--no-session`, but Hazat's runtime always launches child Pi with `--session`; ephemeral side quests would require a different identifier, result channel, and non-resumable public contract, so defer them beyond MVP.

## Answer

Discover named agents from `<parent-cwd>/.pi/agents/*.md` and `$PI_CODING_AGENT_DIR/agents/*.md`, defaulting the latter root to `~/.pi/agent`. The filename stem is the exact, case-sensitive agent name. Project definitions win same-name collisions. Resolve precedence before validation or visibility: a malformed, disabled, or otherwise unusable project definition still shadows its global counterpart. `default` is reserved for the parent clone and never resolves from `default.md`. Do not scan `.agents/agents/` or ship bundled agents.

Parse definitions at extension registration. Enabled definitions require YAML frontmatter with a non-empty `description`; the Markdown body is optional. `enabled: false` is a tombstone and needs neither description nor body. A malformed winning definition or known field with the wrong type is excluded from the catalog and dynamic enum, with one startup/reload warning containing its path and reason; other agents remain usable. Unknown unsupported fields are silently ignored for shared-file compatibility. Definition changes require extension reload.

The consumed definition surface is:

```yaml
---
description: Full role and delegation guidance
display_name: Friendly UI label
enabled: true
model: provider/model-id
thinking: off | minimal | low | medium | high | xhigh | max
tools: all | none | name, name | [name, name]
disallowed_tools: name, name | [name, name]
available_skills: true | false | [name, name]
preload_skills: [name, name]
inherit_context: true
interactive: false
---

Optional agent instructions.
```

`description` is catalog text, not a UI alias. Optional `display_name` is a presentation-only label for pane and widget rendering; it must be a non-empty string when present and falls back to the filename stem. It never changes canonical identity or `subagent_type`. Expose every valid enabled name and its full whitespace-normalized description in the parent system prompt. Do not truncate it or duplicate the catalog in the short `Agent` tool description. Build `Agent.subagent_type` from those names at registration time; it has no `"default"` value.

An omitted `subagent_type` creates the general-purpose parent clone: current model, thinking, native system-prompt inputs, working directory, enabled tools, loaded extensions, and skills. It copies the parent conversation by default. A named agent starts from the same parent baseline, then applies consumed frontmatter and appends preloaded skill bodies followed by its Markdown body after Pi's native prompt sections. There is no `prompt_mode`.

A present `model` must exactly match `provider/model-id` in Pi's registry; invalid explicit values abort launch without fallback. Omitted model and thinking inherit the parent. Invalid thinking values abort launch; valid unsupported levels use Pi's native clamp.

Omitted `tools` inherits the parent's enabled set. Present `tools` replaces it with all registered child tools, none, or an exact allowlist; it may re-enable a registered tool disabled in the parent. `disallowed_tools` subtracts afterward. Unknown named tools abort launch. Every child inherits the parent's loaded extensions. The `side-quests` parent-orchestration entrypoint is inert there, but its child-only runtime companion remains active for status and lifecycle behavior. Finally hard-deny `Agent` and every other subagent-spawning tool regardless of configuration, then force-enable the reserved child control tool `ask_parent`. Neither omission from `tools` nor inclusion in `disallowed_tools` can disable `ask_parent`. Tool policy remains fixed after interactive launch or takeover.

`available_skills` controls the lazy catalog: omission inherits the parent catalog, `true` selects all normally model-invocable child-discovered skills, `false` selects none, and a list selects exactly those names. Explicit names may select skills hidden from model invocation; broad `true` may not. `preload_skills` independently injects full named skill bodies and removes duplicates from the lazy catalog. Unknown names abort launch. Without `read`, omit a non-empty lazy catalog with a launch warning, but still inject preloaded skills.

For new launches, per-call `Agent.inherit_context` and `Agent.interactive` override same-name frontmatter. Without either override, `inherit_context` defaults true and `interactive` defaults false. `inherit_context` controls one-time parent-conversation copying only; set it false for independent or adversarial work unaffected by the parent's conversation. `interactive: false` starts autonomously and closes after completion; `true` stays open. An explicit `Agent.resume` with `interactive: true` or an accepted non-command prompt submitted with Pi input source `interactive` permanently changes an autonomous session to interactive. Editor keystrokes, ordinary programmatic continuation, and other injected messages do not.

Every new child starts in the parent session's current working directory, passed explicitly during tmux pane creation, and uses one persistent plugin-owned Pi session file. MVP ignores `auto-exit`, `cwd`, `max_turns`, `memory`, `persist_session`, `output_transcript`, `session_dir`, `session-mode`, `disable-model-invocation`, extension-selection fields, isolation fields, `run_in_background`, `skills`, and every other unsupported field.
