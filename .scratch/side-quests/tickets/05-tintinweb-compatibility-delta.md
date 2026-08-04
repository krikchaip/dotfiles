# Tintinweb Compatibility Delta

Type: grilling
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model): parent agent and sub-agent name actors; main quest and side quest name tasks.

## Question

After the HazAT baseline is fully audited, which targeted Claude Code-style names, tool parameters, and agent-definition conventions from `tintinweb/pi-subagents` should alter that baseline?

## Comments

- Do not audit Tintinweb as a second runtime baseline.
- Review only compatibility points and ideas surfaced during the HazAT audit.
- Inspect source when README wording is incomplete or disagrees with current behavior.
- Preserve HazAT behavior and earlier decisions unless a specific name provides direct Claude Code-style call-site or shared-file compatibility.
- Compatibility is a narrow naming surface, not a runtime layer and not a second UX baseline.

## Answer

Take only these public names from Tintinweb:

- Tool: `Agent`.
- Request fields: `prompt`, `description`, `subagent_type`, `resume`, and `inherit_context`.
- Shared frontmatter fields: `description`, `display_name`, `enabled`, `model`, `thinking`, `tools`, `disallowed_tools`, and `inherit_context`.

Keep `interactive`, `available_skills`, and `preload_skills` as `side-quests` fields rather than compatibility fields. Keep the resolved local semantics for every name: optional dynamic-enum `subagent_type`, canonical session-path `resume`, strict model and tool validation, case-sensitive filename identity, project/global discovery, fail-closed shadowing, and permanent child permissions.

Do not copy Tintinweb runtime behavior, UI, built-in agents, foreground mode, queueing, grouping, result polling, steering tool, nested agents, worktrees, memory, extension selection, scheduling, model fuzzing, max turns, prompt modes, transcript layer, event RPC, or additional tool parameters. Unsupported shared-file frontmatter remains silently ignored. HazAT's interactive tmux runtime and restrained UX remain authoritative.
