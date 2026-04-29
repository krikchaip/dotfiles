---
description: Delegate current task or specific user input to a subagent
---

# Delegate

Hand off the task at hand to the `agentic` subagent. Provide a complete, exhaustive, and highly detailed task description to ensure the subagent can work as intended without further clarification.

---

## Constraints

- **Completeness**: Task description must be in full. Be as detailed as possible when commanding the subagent.
- **Context**: Stick to recent exchanges for current task definition. Do not summarize/compact history.
- **Tooling**: Use the `Task` tool with `subagent_type: "agentic"`.

---

## Execution Guide

1. **Construct Task**:
   - If user provided arguments, treat them as the core task.
   - If no arguments, define the task based on recent context.
   - Expand instructions into a full engineering prompt. List all known paths, specific logic, environment constraints, and expected outcomes. Do not shorten or summarize details.
   - If details are not clear or the task is vague, grill the user as necessary to extract missing information before delegating.
2. **Launch Subagent**:
   - Call the `Task` tool.
   - `description`: 3-5 word technical label.
   - `prompt`: The exhaustive, detailed instructions constructed in step 1.
3. **Notify User**:
   - Provide a concise summary of the exhaustive prompt sent to the subagent so the user knows what was handed off.

---

## User Input (optional)

> ...$ARGUMENTS
