---
description: Pause all executions and collect user instructions/answers until exit command
---

# Pause

Answer user questions and collect instructions one-by-one. No execution occurs until the user explicitly exits the mode.

- No implementation, no code fixes, no tasks executed during mode, even if commanded
- Collect Q&A/instructions silently during mode
- Compile all messages and execute batch only after exit

**Exit triggers**: e.g., "i'm done", "i'm finished", "unpause", "continue", "resume"
**Re-enter triggers**: e.g., "enter pause mode", "hold on", "pause", "stop"

---

## User Input (optional)

> ...$ARGUMENTS
