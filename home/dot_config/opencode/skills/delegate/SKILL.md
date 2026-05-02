---
name: delegate
description: Route tasks to specialized subagents or default to agentic. Manages session tracking via aliases and supports Sync (single/parallel) execution. Use when user wants to hand off work or says "delegate"
---

# Delegate

## Quick start

When delegating, spawn the appropriate subagent to handle the task. Track the subagent session with an alias (e.g., `3A`, `Mr. GitHub`) so the user can reference or resume it later without losing continuity.

## Workflows

### 1. Task Definition & Routing

- **Construct Prompt**: Expand instructions into a full engineering prompt. List all known paths, specific logic, environment constraints, and expected outcomes.
- **Do Not Summarize**: Be exhaustive. Do not shorten or summarize details from the history.
- **Grill User**: If details are not clear or the task is vague, ask clarifying questions before delegating.
- **Determine Routing**: Evaluate the task against the known capabilities and descriptions of existing specialized sub-agents (e.g., github, browser, schedule).
  - If there is a clear match, delegate to that specific sub-agent.
  - If there is no clear match, or if it doesn't fit neatly into any group, default to the `agentic` sub-agent.

### 2. Session Alias Tracking

To allow the user to refer back to spawned sub-agents (e.g., to continue a conversation or assign follow-up work):

- **Assign Alias**: Use the user-provided alias (e.g., "Mr. GitHub") if specified. If none is provided, generate and assign a 2-digit random hexadecimal alias (e.g., `3A`, `F2`).
- **Store Mapping**: Maintain a mapping in your context between this assigned Alias and the underlying session ID (the `task_id` returned by the `task` tool).
- **Resume Continuity**: When the user refers to an alias later (e.g., "tell Mr. GitHub to do X" or "continue with 3A"), use the corresponding `task_id` to resume that exact sub-agent session instead of spawning a new one.

### 3. Execution

- **Single or Parallel**: You can spawn a single sub-agent or multiple in parallel (waiting for all to finish before proceeding).
- **Tool**: Call the `task` tool.
  - `subagent_type`: The matched sub-agent or `agentic`.
  - `description`: 3-5 word technical label.
  - `prompt`: The exhaustive prompt from Step 1.
  - `task_id`: (Only if resuming a previously aliased session).

### 4. Notification

- Provide a concise summary of the exhaustive prompt sent to the sub-agent so the user knows what was handed off.
- Explicitly state the assigned **Alias** so the user knows how to refer back to it.

## Advanced features

- **Parallel Delegation**: To run multiple tasks in parallel, simply invoke multiple `task` tools at the same time.
