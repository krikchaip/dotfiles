---
agent:
  - agentic
  - ask
---

Use the `codesearch` subagent (via `task` tool with `subagent_type: "codesearch"`) to find relevant code and references **BEFORE** attempting to search or explore the codebase using other tools.
Only use `grep`, `glob`, `list`, or `read` once `codesearch` has been exhausted or for specific local file verification.
