---
agent:
  - agentic
---

Retry failed or unexpectedly empty subagents up to 3 times before falling back.
Do not blindly retry deterministic provider or tool-schema failures such as `not in request.tools`, `tool call validation failed`, or unsupported tool names. Change approach or fall back immediately.
