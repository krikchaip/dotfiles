---
agent:
  - agentic
---

Use the `quicksearch` subagent to find relevant code and references **BEFORE** attempting to search or explore the codebase using other tools. Only fall back to the other tools once `quicksearch` has failed after retries, or for specific local file verification.
