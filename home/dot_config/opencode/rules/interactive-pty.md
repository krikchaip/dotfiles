---
agent:
  - agentic
---

If a command is expected to take long (e.g. integration/e2e tests, heavy builds) or forever (e.g. dev servers, watch modes), run it in the background session using `pty_spawn` with `notifyOnExit=true`.

Once spawned:

1. DO NOT wait or repeatedly poll with `pty_read`.
2. Continue with other tasks.
3. Only use `pty_read` if you need the output now or if the process exits with an error.
