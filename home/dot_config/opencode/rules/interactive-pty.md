---
match: all
tools:
  - bash
  - pty_spawn
  - pty_read
---

If a command is expected to take `>10s` (e.g. dev servers, watch modes, heavy builds), run it in the background using `pty_spawn`.

Once spawned:

1. **DO NOT** wait or repeatedly poll with `pty_read`.
2. Continue with other tasks.
3. Only use `pty_read` if you need the output now or if the process exits with an error.
4. If `notifyOnExit` is enabled, wait for the `<pty_exited>` signal instead of checking status manually.
