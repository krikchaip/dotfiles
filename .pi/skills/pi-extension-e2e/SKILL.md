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

2. Isolate the run.
   - Use an empty temporary cwd so unrelated project `.pi` resources do not trigger trust prompts or alter the root viewport.
   - Use a temporary `PI_CODING_AGENT_DIR` when testing settings or when user settings would affect the scenario. Write only the minimum required `settings.json`.
   - If project resources are required, handle `Trust project folder?` explicitly. Do not silently persist a trust decision.
   - Record `pi --version`. Check which local packages the extension resolves before blaming the extension for a host-version mismatch; do not silently replace `node_modules` to make a test pass.

3. Start Pi inside `expect` with a real pty and explicit extension loading.
   - Use deterministic terminal env: `TERM=xterm-256color COLORTERM=truecolor COLUMNS=<n> LINES=<n> PI_OFFLINE=1`.
   - Call `stty columns <n> rows <n>` after `spawn` when viewport size matters.
   - Use `--no-session --no-context-files --no-prompt-templates --no-themes --no-extensions --no-skills` unless the scenario needs those resources.
   - Load the extension with `-e /absolute/runtime/extension.ts`.
   - For an extension stack, list every runtime path and load them in intended order. Assert an effect from each dependency; a spawned command line is not proof of loading.
   - Test optional adapters in both modes: base extension alone, then base extension plus adapter. The no-adapter run proves ordinary terminals and text-only viewport behavior stay safe.
   - Load dependent skills/resources explicitly, e.g. `--skill /absolute/SKILL.md`; explicit skills still load with `--no-skills`.

4. Answer terminal probes, then wait for scenario-specific readiness.
   - Reply to `ESC[c` with `ESC[?1;2c`.
   - Reply to `ESC[?u` with `ESC[?0u`.
   - Use a short expect timeout and keep polling until a deadline.
   - Wait for an extension-owned marker and then a stable editor/footer token. `$0.000` is only an example; custom footers may never render it.
   - Do not wait on model names because they can appear before the editor exists.
   - Treat a missing readiness pattern as test failure, not a successful timeout.

5. Drive and isolate the user-visible transition.
   - Send the exact terminal encoding that reproduces the behavior.
   - Rotate to a fresh log after readiness when the expected text may already have appeared during startup.
   - Drain after each key burst so repaint output is captured.
   - Graphics-adapter wire proof keeps startup and transition logs separate; assert startup transmission in startup output and repaint cleanup in action output.
   - Prefer narrow `COLUMNS` when testing wrapping, truncation, ellipsis, or key hints.
   - Remember that chat root top can include startup help and warnings before injected messages.
   - Exit with Ctrl-C/Ctrl-D and close the pty.

6. Assert on ANSI, not eyeballs.
   - Check behavior text and ANSI controls together when styling matters.
   - Check positive behavior: expected token/control sequence exists.
   - Check negative behavior: unwanted highlight/control sequence is absent.
   - For graphics-adapter wire proof, assert command, transport envelope, and cleanup scope: e.g. tmux-wrapped Kitty APC, no direct fallback, and `d=a` rather than `d=A`.
   - For state transitions, capture and assert both states separately, such as highlighted during drag and plain after release.
   - The expect script must exit nonzero when a required pattern is absent. A completed process alone is not a passing E2E test.
   - On failure, print a readable ANSI slice.

## Graphics adapters: wire proof

Wire proof verifies bytes at a terminal-adapter boundary; pixel proof verifies a real emulator.

- Replay deterministic history long enough to cross the viewport. Use a captured production image when dimensions, placement, or scroll behavior matter.
- Make the capability boundary explicit in `spawn`: set `TMUX`, tmux-like `TERM`, and only required outer-terminal variables. Assert emitted bytes at this boundary.
- Label nested-pty evidence as wire proof. When pixel placement matters, add an interactive visual check in real tmux and terminal emulator.
- For non-BMP placeholders in Expect logs, assert neighboring stable evidence: placement APC, SGR foreground/underline metadata, structural UI text, and cleanup commands.
- Make assertions fail closed: begin shell blocks with `set -e`; use `"text".encode()` for non-ASCII Python byte checks.
- Delete temporary fixtures, sessions, logs, and isolated cwd after verification.

## Reusable expect harness

Copy this, then edit the paths, readiness pattern, and `scenario` proc. Keep `send --` and escaped arrow brackets; raw `send "\033[C"` is Tcl syntax poison (`missing close-bracket`).

```expect
#!/usr/bin/expect -f
set timeout 1
set log_path "/tmp/pi-extension.e2e.ansi"
set extension_path "/absolute/runtime/extension.ts"
set work_dir "/tmp/pi-extension-e2e-cwd"
set columns 80
set rows 30

file mkdir $work_dir
cd $work_dir
log_file -noappend $log_path
spawn env TERM=xterm-256color COLORTERM=truecolor COLUMNS=$columns LINES=$rows PI_OFFLINE=1 \
  pi --no-session --no-context-files --no-prompt-templates --no-themes --no-extensions --no-skills \
  -e $extension_path
stty columns $columns rows $rows

proc drain_until {seconds pattern} {
  set deadline [expr {[clock milliseconds] + ($seconds * 1000)}]
  while {[clock milliseconds] < $deadline} {
    expect {
      "\033\[c" { send "\033\[?1;2c"; exp_continue -continue_timer }
      "\033\[?u" { send "\033\[?0u"; exp_continue -continue_timer }
      "Trust project folder?" {
        puts stderr "unexpected project trust prompt; use an isolated cwd or handle it explicitly"
        return 0
      }
      -re $pattern { return 1 }
      timeout {}
      eof { return 0 }
    }
  }
  return 0
}

proc drain_for {seconds pattern} {
  set deadline [expr {[clock milliseconds] + ($seconds * 1000)}]
  while {[clock milliseconds] < $deadline} {
    expect {
      "\033\[c" { send "\033\[?1;2c"; exp_continue -continue_timer }
      "\033\[?u" { send "\033\[?0u"; exp_continue -continue_timer }
      -re $pattern { exp_continue -continue_timer }
      timeout {}
      eof { return }
    }
  }
}

proc scenario {} {
  send -- "/scenario\r"
  after 800
  send -- "\033\[B\r"
  drain_for 4 {expected|menu|text|─|…}
}

set ready_pattern {\$0\.000}
if {![drain_until 8 $ready_pattern]} {
  puts stderr "Pi TUI did not become ready: $ready_pattern"
  send "\003\003"
  close
  exit 1
}

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
send -- "\033\[1;6A"            ;# ctrl+shift+up (legacy CSI)
send -- "\033\[<0;2;1M"         ;# SGR mouse left press at col 2, row 1
send -- "\033\[<32;6;1M"        ;# SGR mouse left drag to col 6, row 1
send -- "\033\[<0;6;1m"         ;# SGR mouse release
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
- For scrolling tests, inject enough deterministic messages to exceed the root viewport. Assert the actual root-top content; startup help may precede the first injected message.

For transitions whose old state may exist in startup output, rotate logs after readiness:

```expect
log_file
log_file -noappend "/tmp/pi-extension.action.ansi"
send -- "\033\[1;6A"
if {![drain_until 5 {expected after action}]} {
  puts stderr "action did not render expected state"
  exit 1
}
```

For mouse behavior, keep drag and release in separate logs. First prove the selection ANSI exists during drag, then prove the same selection ANSI is absent after release. Derive coordinates and the expected selected substring from the captured viewport instead of guessing them.

## Reusable ANSI assertions

Run the expect script, then assert with Python. Keep assertions close to the user-visible behavior.

```bash
set -e
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

require(s, 'extension-owned marker', 'extension effect')
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

If the capture only shows startup or footer, input probably arrived before the editor was ready. Wait for a scenario-owned marker and a stable editor/footer token, then rotate the log and send input.

If the expected token appears before the action, the assertion may be a false positive. Capture the action in a fresh log.

If Expect exits zero but a marker is absent, the drain helper is not propagating timeout failure. Make required waits return a boolean and exit nonzero.

If Expect reports `missing close-bracket`, an arrow key likely used raw `send "\033[C"`. Use `send -- "\033\[C"`.

## Scenario checklist

Use this before calling E2E done:

- Extension/runtime source applied if needed.
- Pi and resolved dependency versions are known.
- Empty cwd or explicit project-trust handling prevents surprise startup UI.
- Harness uses a real pty, deterministic env, explicit extension loading in dependency order, and only required resources.
- Optional adapters have both baseline and adapter-enabled coverage.
- Probe replies are handled.
- Required readiness waits fail on timeout.
- Input waits for a scenario-owned marker and stable editor/footer token.
- Scenario sends exact terminal encodings.
- Action output is isolated when startup can contain the same text; graphics-adapter wire-proof phases use separate captures.
- Capture is drained after input.
- Assertions check positive and negative rendered states with relevant ANSI.
- Graphics-adapter wire proof covers expected transport, no direct fallback, and safe cleanup scope.
- Image fixtures use representative dimensions; pixel proof uses a real terminal when required.
- Shell/Python assertions fail closed, including Unicode-safe byte checks.
- Narrow viewport run exists for wrapping/truncation/ellipsis/keyhint changes.
- Failure prints a readable slice and exits nonzero.
