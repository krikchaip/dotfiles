---
description: Create or maintain lean Zettelkasten docs
argument-hint: "[task]"
---

Create new documentation or maintain existing documentation for ${@:-a recent task.}

- Use pragmatic Zettelkasten: one coherent concept per note, local context, and links to canonical notes or code instead of repeated facts.
- Keep only information needed to act safely or understand behavior. Use short, direct language.
- Put code comments beside what they explain. Every enum option gets a trailing inline comment describing domain meaning:
  ```ts
  "collected", // Durable source change waiting to publish.
  ```
- Preserve runtime behavior.

Before finishing, search the full requested scope for omissions and run the relevant formatter or linter.
