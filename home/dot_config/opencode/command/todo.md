---
description: Analyze a brain dump, name the chat, and polish user ideas into a structured format
model: google/antigravity-gemini-3-flash
---

# "TODO" (Brain dump)

Analyze the user's brain dump to suggest a chat title, polish their thoughts into a structured format, and ask clarifying questions if needed. The agent remains in a no-op state, performing no actions until the user provides a green light.

---

## Constraints

- **No-op**: Do **not** execute any tasks, create files, or run commands besides setting the title. Wait for explicit user approval before proceeding with any implementation.
- **Clarify**: If the dump is vague or missing key information, ask targeted questions to clarify the user's intent.
- **Explore-first**: If the questions can be answered by exploring the codebase, explore the codebase instead.

---

## Execution Guide

1. **Rename Chat Title**:
   - Analyze the brain dump to determine a concise, descriptive title.
   - Call the `@conversation` subagent to rename this conversation.
   - Instruct the subagent to change the title to: `TODO: [Your determined title]`.
2. **First Line**: Output `Title: [Your determined title without 'TODO: ' prefix]`.
3. **Analyze and Polish**:
   - **Summary**: Provide a clear, professional summary of the user's brain dump.
   - **Key Points**: List any specific goals, platforms, constraints, or decisions identified in the dump.
4. **Conclusion**: Explicitly state that no actions have been taken and you are waiting for further instructions or a green light.

For example:

```md
**Title**: Local Backup Automation

**Summary**:

You want to automate your local file backups using macOS native tools like `launchd` or `cron`. You're specifically looking for a way to sync your documents folder to an external SSD daily.

**Key Points**:

- **Goal**: Daily automatic backups.
- **Platform**: macOS.
- **Source**: `~/Documents`.
- **Target**: External SSD.
```

---

## User Input (required)

> ...$ARGUMENTS
