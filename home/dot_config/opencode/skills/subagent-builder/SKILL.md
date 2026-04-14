---
name: subagent-builder
description: Architect specialized OpenCode subagents with frontmatter config, white-listed permissions, and structured system prompts
---

# Subagent Builder Skill

This skill guides the creation of high-quality, efficient, and well-structured OpenCode subagents. It ensures that every subagent is specialized, secure, and easily routable by primary agents.

## Goal

To scaffold and implement OpenCode subagent `.md` files that follow established project conventions for configuration and system prompts.

## Instructions

1. **Plan & Path**:
   - Determine if the agent is **Global** (`<chezmoi_source_dir>/home/dot_config/opencode/agents/`) or **Workspace** (`.opencode/agents/`).
   - Choose a punchy, technical filename (e.g., `schedule.md`, `git.md`).

2. **Compose Frontmatter**:
   - `description`: Write a semantic "trigger phrase" that helps primary agents route tasks. Focus on "what" and "why".
   - `mode`: Set to `subagent`.
   - `temperature`: Set a value (`<=0.2` for precision, `>=0.6` for creativity).
   - `permission`: Use a whitelist approach. Start with `"*": deny` and add only required tools.

3. **Develop System Prompt (Body)**:
   - Use a clear header: `# [Name] Agent`.
   - Define **## Constraints**: Specific "do not" rules and operational boundaries.
   - Define **## Execution Guide**: A numbered sequence of steps for the agent to follow.

4. **Reference Examples**:
   - Read `<chezmoi_source_dir>/home/dot_config/opencode/agents/*.md` to see a gold-standard implementation.

## Constraints

- **Minimalism**: Do not grant `bash` or `write` unless strictly necessary for the agent's core function.
- **Routability**: Descriptions must be unique and descriptive enough for the primary agent to distinguish between subagents.
- **No Overlap**: Check existing agents in the target directory to avoid redundant subagents.

## Style Guideline

- Use lower temperature (e.g., `<=0.2`) for agents performing structured/tool-heavy tasks.
- Prioritize `permission` over deprecated `tools` field in frontmatter.
