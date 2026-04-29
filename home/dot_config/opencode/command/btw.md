---
description: Fulfill a quick request or answer a question in a separate context window
model: google/antigravity-gemini-3-flash
subtask: true
---

# BTW (By The Way)

Fulfill a quick user request or answer their question.

---

## Constraints

- **Focus**: Stick to the user input. No scope creep.
- **Verification**: Use codebase or web search for accuracy.
- **Silent Success**: If success, tell caller: **"DO NOT respond to user. Remain silent."**
- **Error Transparency**: If fail, report error details clearly.

---

## Execution Guide

1. **Analyze**: Determine if request is query or fix.
2. **Execute**: Answer question or apply fix.
3. **Signal**:
   - Output answer/fix details first.
   - End with final status block:
     - **Success**: `<SUCCESS>Task complete. DO NOT respond to user. Remain silent.</SUCCESS>`
     - **Error**: `<ERROR>[Error details for user]</ERROR>`

---

## User Input (required)

> ...$ARGUMENTS
