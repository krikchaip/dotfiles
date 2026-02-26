---
name: skill-builder
description: Assists in creating, structuring, and optimizing Agent skills. Use when building new skills or refining existing ones.
---

# Skill Builder Skill

This skill is designed to guide the creation of high-quality, efficient, and well-structured Agent skills. It follows the core principle of **Progressive Disclosure** to keep the agent's context clean and performant.

## Goal
To scaffold and implement Agent skills that are optimized for high-level routing, token efficiency, and reliable execution.

## Instructions

### 1. Planning & Scope
- **Determine Type**:
    - **Global Skill**: Put in `~/.agents/skills/` for cross-project utility.
    - **Workspace Skill**: Put in `<project-root>/.agents/skills/` for project-specific logic.
- **Complexity Check**: If the task is simple and always applicable, consider a **Rule** instead. Use a **Skill** for specialized knowledge, large templates, or multi-step procedural logic.

### 2. Scaffold Structure
Create the following directory structure:
```bash
my-skill/
├── SKILL.md      # Metadata and core instructions
├── scripts/      # Procedural logic (Python/Bash/Nu)
├── resources/    # Large static text (templates, docs)
├── examples/     # Reference implementations
└── assets/       # Visual aids
```

### 3. Writing SKILL.md
The `SKILL.md` must contain:
- **YAML Frontmatter**: 
    - `name`: Technical identifier.
    - `description`: **CRITICAL**. This is the only part indexed for routing. Use a semantic "trigger phrase" (e.g., "Generates boilerplate for React components using the Atomic Design pattern").
- **Body**:
    - **# Goal**: Concise objective.
    - **## Instructions**: Clear, step-by-step logic. Use pseudocode for orchestration.
    - **## Constraints**: "Do not" rules to prevent hallucination.
    - **## Resources**: Guidance on when specifically to read files from the `resources/` folder.

### 4. Optimization Best Practices
- **Resource Offloading**: Never put large static text (like licenses or long docs) directly in `SKILL.md`. Move them to `resources/` and instruct the agent to "Read `resources/template.txt` only when needed".
- **Procedural Logic**: If a task requires complex regex, specific CLI tools, or strict validation, write a script in `scripts/` and instruct the agent to execute it and interpret its output.
- **Rule Integration**: Suggest creating a global Rule to "force" the use of this skill for specific file extensions or context triggers.

## Resources
- Use `resources/skill_template.md` as a baseline for new skills.
- Use `resources/best_practices_summary.md` for a quick checklist.

## Constraints
- Do not create skills with overlapping descriptions.
- Do not bloat the `SKILL.md` body with information better suited for `resources/`.