---
agent:
  - agentic
---

Use `@quicksearch` first for code search.

- If it fails with a provider or tool-schema error (for example `not in request.tools` or `tool call validation failed`), fall back immediately to bash-first local search using `read`, `ripgrep`, `find`, and `ls`.
- If it returns an unexpected empty result, retry per the retry rule before falling back.

Skip `@quicksearch` when you only need small local verification.
