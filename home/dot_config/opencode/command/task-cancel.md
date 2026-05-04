---
description: Cancel running async subtasks
---

# Task Cancel

Cancel one or all running async subtasks in this session using the `task_cancel` tool.

---

## Constraints

- **Tool-only**: Use `task_cancel` tool. No other actions.
- **Silent Success**: If success, respond with only the tool output.

---

## Execution Guide

1. If no user input is provided, call `task_cancel` with no arguments to cancel all.
2. If user input is provided, interpret the natural language to identify which subtask they want to cancel. Match against the task descriptions or subagent types from earlier `task_async` calls in this conversation, then call `task_cancel` with the matching `task_id`.

---

## User Input (optional)

> ...$ARGUMENTS
