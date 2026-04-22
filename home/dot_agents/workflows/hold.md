---
description: Hold all execution and collect user instructions/answers until exit command
---

# Hold

Answer user questions and collect instructions one-by-one. No execution occurs until the user explicitly exits the mode.

- No implementation, no code fixes, no tasks executed during mode, even if commanded
- Collect Q&A/instructions silently during interrogation
- Compile all messages and execute batch only after exit

**Exit triggers**: e.g., "i'm done", "i'm finished", "exit hold mode", "continue", "hold off"
**Re-enter triggers**: e.g., "enter hold mode", "hold on"

---

## User Input (optional)

> ...$ARGUMENTS
