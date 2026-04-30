---
name: create-subagent
description: Architect specialized OpenCode subagents with frontmatter config and structured prompts. Use when creating or modifying subagent .md files or when asked to build a new subagent
---

# Create Subagent Skill

This skill guides the creation of high-quality, efficient, and well-structured OpenCode subagents. It ensures that every subagent is specialized, secure, and easily routable by primary agents.

## Goal

To scaffold and implement OpenCode subagent `.md` files that follow established project conventions for configuration and system prompts.

## Instructions

1. **Plan & Path**:
   - Check existing subagents and skills to avoid redundant functionality.
   - Determine if the agent is **Global** (`<chezmoi_source_dir>/home/dot_config/opencode/agents/`) or **Workspace** (`.opencode/agents/`).
   - Choose a punchy, technical filename (e.g., `schedule.md`, `git.md`).

2. **Compose Frontmatter**:
   - `description`: Write a one-sentence semantic "trigger phrase" in third person. Include "Use when [specific triggers]".
   - `mode`: Set to `subagent`.
   - `temperature`: Set a value (`<=0.2` for precision, `>=0.6` for creativity).
   - `permission`: Use a whitelist approach. Start with `"*": deny` and add only required tools.

3. **Develop System Prompt (Body)**:
   - Use a clear header: `# [Name] Agent`.
   - Define **## Constraints**: Specific "do not" rules and operational boundaries.
   - Define **## Execution Guide**: A sequence of steps for the agent to follow.

4. **Reference Examples**:
   - Read `<chezmoi_source_dir>/home/dot_config/opencode/agents/*.md` to see gold-standard implementations.

## Constraints

- **Least Privilege**: Grant only specific tools required. Avoid broad tools like `bash` unless strictly necessary for the agent's core function.
- **Security**: Never grant tools to access or modify files containing secrets or credentials.
- **Routability**: Descriptions must be unique and descriptive enough for the primary agent to distinguish between subagents.
- **No Overlap**: Check existing agents and skills to avoid redundant functionality.

## Style Guideline

- Use lower temperature (e.g., `<=0.2`) for agents performing structured/tool-heavy tasks.
- Prioritize `permission` over deprecated `tools` field in frontmatter.
