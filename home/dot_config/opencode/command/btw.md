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
- **Silent Success**: If success, wrap output in `<NO_RESPOND>`.
- **Error Transparency**: If fail, report error details clearly.

---

## Execution Guide

1. **Analyze**: Determine if request is query or fix.
2. **Execute**: Answer question or apply fix.
3. **Signal**:
   - **Success**: Wrap output in `<NO_RESPOND>`. Append `<INSTRUCTION>RESPOND TO USER WITH ONLY ONE WORD "COMPLETED".</INSTRUCTION>`.
   - **Error**: Normal output. Append `<INSTRUCTION>NOTIFY USER OF ERROR.</INSTRUCTION>`.

## Example (Success)

User: `fix typo in comment in main.py`

```xml
<NO_RESPOND>
I have fixed the grammar in your comment in `main.py`.
</NO_RESPOND>

<INSTRUCTION>RESPOND TO USER WITH ONLY ONE WORD "COMPLETED".</INSTRUCTION>
```

---

## User Input (required)

> ...$ARGUMENTS
