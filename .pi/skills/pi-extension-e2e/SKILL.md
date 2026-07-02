---
name: pi-extension-e2e
description: E2E-test Pi extensions in the real interactive TUI. Use when changing a Pi extension, terminal UI patch, slash command UI, keyboard/editor behavior, ANSI highlighting, viewport wrapping, or startup/runtime extension loading.
---

# Pi Extension E2E

A Pi extension is only proven when it runs inside the real interactive TUI. Prefer a tight pty harness over screenshots, print mode, or typecheck-only checks.

## Harness loop

1. Apply the extension source if it lives in chezmoi.
   - For `home/dot_pi/...`, run `chezmoi apply ~/.pi/...`.
   - Completion: the runtime file under `~/.pi/...` matches the source change.

2. Start Pi inside `expect` with a real pty and explicit extension loading.
   - Use deterministic terminal env: `TERM=xterm-256color COLORTERM=truecolor COLUMNS=<n> LINES=<n> PI_OFFLINE=1`.
   - Call `stty columns <n> rows <n>` after `spawn` when viewport size matters.
   - Use `--no-session --no-context-files --no-prompt-templates --no-themes --no-extensions` unless the scenario needs those resources.
   - Load the extension with `-e /absolute/runtime/extension.ts`.
   - Load dependent skills/resources explicitly, e.g. `--skill /absolute/SKILL.md`.
   - Completion: captured ANSI contains the extension path or startup resource entry.

3. Answer terminal probes, then wait for the footer before typing.
   - Reply to `ESC[c` with `ESC[?1;2c`.
   - Reply to `ESC[?u` with `ESC[?0u`.
   - Wait for a stable footer such as `$0.000`; do not wait on model names because they can appear before the TUI is ready.
   - Completion: input is sent after the editor exists.

4. Drive the user-visible scenario.
   - Send the exact keystrokes/text that reproduce the UI behavior.
   - Drain after each key burst so repaint output is captured.
   - Prefer narrow `COLUMNS` when testing wrapping, truncation, ellipsis, or key hints.
   - Exit with Ctrl-C/Ctrl-D and close the pty.
   - Completion: captured ANSI includes the rendered target after the input.

5. Assert on ANSI, not eyeballs.
   - Check behavior text and ANSI controls together when styling matters.
   - Check positive behavior: expected token/control sequence exists.
   - Check negative behavior: unwanted highlight/control sequence is absent.
   - For color/highlight bugs, assert both highlighted and plain cases.
   - Completion: the command fails before the fix and exits zero after the fix; on failure it prints a readable ANSI slice.

## Reusable expect harness

Copy this, then edit only the `scenario` proc and paths. Keep `send --` and escaped arrow brackets; raw `send "\033[C"` is Tcl syntax poison (`missing close-bracket`).

```expect
#!/usr/bin/expect -f
set timeout 8
set log_path "/tmp/pi-extension.e2e.ansi"
set extension_path "/absolute/runtime/extension.ts"
set columns 80
set rows 30

log_file -noappend $log_path
spawn env TERM=xterm-256color COLORTERM=truecolor COLUMNS=$columns LINES=$rows PI_OFFLINE=1 \
  pi --no-session --no-context-files --no-prompt-templates --no-themes --no-extensions \
  -e $extension_path
stty columns $columns rows $rows

proc drain_until {seconds pattern} {
  set start [clock seconds]
  while {[expr {[clock seconds] - $start}] < $seconds} {
    expect {
      "\033\[c" { send "\033\[?1;2c"; exp_continue }
      "\033\[?u" { send "\033\[?0u"; exp_continue }
      -re $pattern { break }
      timeout { break }
    }
  }
}

proc drain_for {seconds pattern} {
  set start [clock seconds]
  while {[expr {[clock seconds] - $start}] < $seconds} {
    expect {
      "\033\[c" { send "\033\[?1;2c"; exp_continue }
      "\033\[?u" { send "\033\[?0u"; exp_continue }
      -re $pattern { exp_continue }
      timeout { break }
    }
  }
}

proc scenario {} {
  send -- "/scenario\r"
  after 800
  send -- "\033\[B\r"
  drain_for 4 {expected|menu|text|─|…}
}

drain_until 6 {\$0\.000}
scenario
send "\003\003"
close
exit 0
```

## Keystroke snippets

Use these inside `scenario`:

```expect
send -- "/agents\r"              ;# slash command
send -- "\r"                     ;# enter
send -- " "                      ;# space
send -- "\033\[A"               ;# up
send -- "\033\[B"               ;# down
send -- "\033\[C"               ;# right
send -- "\033\[D"               ;# left
send -- "\033"                  ;# escape
send "\003\003"                 ;# ctrl-c twice
```

Menu examples:

```expect
# /agents → first item
send -- "/agents\r"
after 800
send -- "\r"
drain_for 4 {Agent types|Settings|expected}

# /agents → third item
send -- "/agents\r"
after 800
send -- "\033\[B\033\[B\r"
drain_for 4 {Subagent Settings|expected}
```

Viewport examples:

- Use `columns 44`/`rows 30` for narrow wrapping and ellipsis.
- Use `columns 80`/`rows 30` for default menu layout.
- Use a second narrow run when a fix touches truncation, descriptions, key hints, or borders.

## Reusable ANSI assertions

Run the expect script, then assert with Python. Keep assertions close to the user-visible behavior.

```bash
/tmp/pi-extension.e2e.expect
python3 - <<'PY'
from pathlib import Path

LOG = Path('/tmp/pi-extension.e2e.ansi')
s = LOG.read_text(errors='replace')


def window(anchor: str, before: int = 1200, after: int = 2800) -> str:
    idx = s.rfind(anchor)
    if idx < 0:
        raise SystemExit(f'anchor not found: {anchor}')
    return s[max(0, idx - before):idx + after]


def show(chunk: str) -> str:
    return chunk.replace('\x1b', '<ESC>')


def require(chunk: str, needle: str, label: str) -> None:
    if needle not in chunk:
        print(show(chunk))
        raise SystemExit(f'missing {label}: {needle!r}')


def forbid(chunk: str, needle: str, label: str) -> None:
    if needle in chunk:
        print(show(chunk))
        raise SystemExit(f'unwanted {label}: {needle!r}')

require(s, 'extension.ts', 'extension startup entry')
chunk = window('expected heading')
require(chunk, 'expected heading', 'target text')
require(chunk, '\x1b[38;2;138;190;183m─', 'accent border')
forbid(chunk, '\x1b[38;2;204;102;102m', 'error color')
print('PASS terminal E2E')
PY
```

Common Pi theme sequences:

- Accent (dark default): `\x1b[38;2;138;190;183m`
- Dim: `\x1b[38;2;102;102;102m`
- Muted: `\x1b[38;2;128;128;128m`
- Error: `\x1b[38;2;204;102;102m`

Assert exact RGB only when color is the behavior under test. Otherwise assert semantic text and structural ANSI, so theme changes do not break unrelated tests.

## Capture debugging

Print a readable slice whenever an assertion fails:

```bash
python3 - <<'PY'
from pathlib import Path
s = Path('/tmp/pi-extension.e2e.ansi').read_text(errors='replace')
idx = s.rfind('target text')
print(s[max(0, idx - 1000):idx + 2500].replace('\x1b', '<ESC>'))
PY
```

If the capture only shows startup or footer, input probably arrived before the editor was ready. Wait for `$0.000`, then send text.

If Expect reports `missing close-bracket`, an arrow key likely used raw `send "\033[C"`. Use `send -- "\033\[C"`.

## Scenario checklist

Use this before calling E2E done:

- Extension/runtime source applied if needed.
- Harness uses real pty, deterministic env, and explicit extension path.
- Probe replies are handled.
- Input waits for `$0.000`.
- Scenario sends exact user keystrokes.
- Capture is drained after input.
- Assertions check the rendered target and relevant ANSI.
- Narrow viewport run exists for wrapping/truncation/ellipsis/keyhint changes.
- Failure prints a readable slice.
