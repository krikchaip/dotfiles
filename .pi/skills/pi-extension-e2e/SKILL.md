---
name: pi-extension-e2e
description: E2E-test Pi extensions in the real interactive TUI. Use when changing a Pi extension, terminal UI patch, slash command UI, keyboard/editor behavior, ANSI highlighting, or startup/runtime extension loading.
---

# Pi Extension E2E

A Pi extension is only proven when it runs inside the real interactive TUI. Prefer a pty **harness** over screenshots, print mode, or typecheck-only checks.

## Harness loop

1. Apply the extension source if it lives in chezmoi.
   - For `home/dot_pi/...`, run `chezmoi apply ~/.pi/...`.
   - Completion: the runtime file under `~/.pi/...` matches the source change.

2. Start Pi inside `expect` with a real pty and explicit extension loading.
   - Use `PI_OFFLINE=1` to avoid network noise.
   - Use `--no-session --no-context-files --no-prompt-templates --no-themes --no-extensions` unless the scenario needs those resources.
   - Load the extension with `-e /absolute/runtime/extension.ts`.
   - Load dependent skills/resources explicitly, e.g. `--skill /absolute/SKILL.md`.
   - Completion: captured ANSI contains the extension filename in startup resources.

3. Answer terminal probes, then wait for the footer before typing.
   - Reply to `ESC[c` with `ESC[?1;2c`.
   - Reply to `ESC[?u` with `ESC[?0u`.
   - Wait for a stable footer such as `$0.000`; do not wait on model names because they can appear before the TUI is ready.
   - Completion: input is sent after the editor exists.

4. Drive the user-visible scenario.
   - Send the exact keystrokes/text that reproduce the UI behavior.
   - Keep draining the pty after input so repaint output is captured.
   - Exit with Ctrl-C/Ctrl-D and close the pty.
   - Completion: captured ANSI includes the rendered target text after the input.

5. Assert on ANSI, not eyeballs.
   - Check positive behavior: expected token/control sequence exists.
   - Check negative behavior: unwanted highlight/control sequence is absent.
   - For color/highlight bugs, assert both highlighted and plain cases.
   - Completion: one command exits nonzero before the fix and zero after the fix.

## Template

```expect
#!/usr/bin/expect -f
set timeout 8
log_file -noappend /tmp/pi-extension.e2e.ansi
spawn env TERM=xterm-256color COLORTERM=truecolor PI_OFFLINE=1 \
  pi --no-session --no-context-files --no-prompt-templates --no-themes --no-extensions \
  -e /Users/asol/.pi/agent/extensions/example.ts

set start [clock seconds]
while {[expr {[clock seconds] - $start}] < 5} {
  expect {
    "\033\[c" { send "\033\[?1;2c"; exp_continue }
    "\033\[?u" { send "\033\[?0u"; exp_continue }
    -re {\$0\.000} { break }
    timeout { break }
  }
}

send -- "/scenario text"
set start [clock seconds]
while {[expr {[clock seconds] - $start}] < 4} {
  expect {
    "\033\[c" { send "\033\[?1;2c"; exp_continue }
    "\033\[?u" { send "\033\[?0u"; exp_continue }
    -re {scenario|expected|text} { exp_continue }
    timeout { break }
  }
}

send "\003\003"
close
exit 0
```

Then assert with a small script:

```bash
/tmp/pi-extension.e2e.expect
python3 - <<'PY'
from pathlib import Path
s = Path('/tmp/pi-extension.e2e.ansi').read_text(errors='replace')
if 'example.ts' not in s:
    raise SystemExit('extension did not load')
if 'expected plain text' not in s:
    raise SystemExit('target text did not render')
if '\x1b[38;2;138;190;183m/\x1b[39m' in s:
    raise SystemExit('single slash was highlighted')
print('PASS terminal E2E')
PY
```

## Debugging the capture

Print a readable slice when an assertion fails:

```bash
python3 - <<'PY'
from pathlib import Path
s = Path('/tmp/pi-extension.e2e.ansi').read_text(errors='replace')
idx = s.rfind('/scenario')
print(s[max(0, idx-500):idx+2000].replace('\x1b', '<ESC>'))
PY
```
