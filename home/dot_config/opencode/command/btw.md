---
description: Fulfill a quick request or answer a question in a separate context window
model: opencode/big-pickle
subtask: true
---

# BTW (By The Way)

Fulfill a quick user request or answer their question. Reference the parent session using `@conversation` if needed.

---

## Constraints

- **Scope**: Focus strictly on the provided request.
- **Clarity**: Provide structured and easy-to-digest answers. Use code snippets or diagrams where appropriate to illustrate points.
- **Verification**: Confirm accuracy using the codebase for local context and web search for general knowledge.

---

## User Input (optional)

> ...$ARGUMENTS

