---
description: Durable notes for chezmoi repo AI prompt architecture and key config gotchas
label: ai-prompts
limit: 5000
read_only: false
---

- Chezmoi repo centralizes AI prompt policy in `home/dot_agents/RULES.md.tmpl`. Symlinked into multiple runtimes:
  - OpenCode via `home/dot_config/opencode/symlink_AGENTS.md.tmpl`
  - Gemini via `home/dot_gemini/symlink_GEMINI.md.tmpl`
  - Windsurf via `home/dot_codeium/windsurf/memories/symlink_global_rules.md.tmpl`
- OpenCode-specific behavior then layers on:
  - `home/dot_config/opencode/opencode.jsonc` (plugins, agents, permissions)
  - `home/dot_config/opencode/agents/*.md` (per-agent prompts + permissions)
  - `home/dot_config/opencode/rules/*.md` (rule injections)
  - `home/dot_config/opencode/skills/*` (skills, optional)
- `.opencode/opencode.jsonc` is local sandbox override, not main deployed config
  - it broadly allows home-directory bash/external access for local repo experimentation
