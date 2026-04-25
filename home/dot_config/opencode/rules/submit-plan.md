---
tools:
  - submit_plan
---

**`submit_plan` is DESTRUCTIVE and IRREVERSIBLE** — it immediately executes against production with NO undo. **NEVER** call it unless the user has given an explicit command in this conversation (e.g. "submit plan", "submit it"). Inferring permission, asking "should I submit?", or calling proactively are all **critical safety violations**. Default state: present your plan in chat, say "Plan ready", and **STOP**. Wait for the user's explicit command.
