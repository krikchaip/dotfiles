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
- [Agent Definition Overlays](09-agent-definition-overlays.md) supersedes whole-file shadowing, and [Unified Agent Capability Selection](10-unified-capability-selection.md) supersedes the historical capability fields and inherited-extension rule in this audit.

## Answer

Take only these public names from Tintinweb:

- Tool: `Agent`.
- Request fields: `prompt`, `description`, `subagent_type`, `resume`, and `inherit_context`.
- Shared frontmatter fields retained from Tintinweb: `description`, `display_name`, `enabled`, `model`, `thinking`, `tools`, and `inherit_context`.

Keep `interactive`, `extensions`, and `skills` as `side-quests` fields rather than compatibility fields. Do not add compatibility aliases or migration behavior for former capability field spellings; silently ignore them as unrecognized frontmatter. Keep the resolved local semantics for every consumed name: optional dynamic-enum `subagent_type`, canonical session-path `resume`, strict model and capability validation, case-sensitive filename identity, project/global overlay, and permanent child permissions.

Do not copy Tintinweb runtime behavior, UI, built-in agents, foreground mode, queueing, grouping, result polling, steering tool, nested agents, worktrees, memory, scheduling, model fuzzing, max turns, prompt modes, transcript layer, event RPC, or additional tool parameters. Side Quests uses its own resolved extension-selection design. Unsupported unrelated shared-file frontmatter remains silently ignored. HazAT's interactive tmux runtime and restrained UX remain authoritative.
