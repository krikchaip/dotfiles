# Expect driver

Read this only after the live tmux reproduction gate in [`../SKILL.md`](../SKILL.md) passes. Expect is a good fit when a compact pty script can preserve the reproduced terminal probes, input bytes, timing, and viewport. Use another driver when it matches the proven path better.

## Starting harness

Edit the paths, readiness pattern, and `scenario` procedure. Keep `send --` and escaped arrow brackets. Raw `send "\033[C"` is invalid Tcl and causes `missing close-bracket`.

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

The `--no-*` flags and isolated cwd are valid only after live reproduction proves that removing the user's resources does not change the result.

## Input bytes

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

## Viewport and transition capture

- Use `columns 44` and `rows 30` for narrow wrapping and ellipsis.
- Use `columns 80` and `rows 30` for default menu layout.
- Add a narrow run when a fix touches truncation, descriptions, key hints, or borders.
- For scrolling, load enough deterministic session history to exceed the root viewport. Assert the actual root-top content because startup help can precede the first injected message.

Rotate logs when the old state can exist in startup output:

```expect
log_file
log_file -noappend "/tmp/pi-extension.action.ansi"
send -- "\033\[1;6A"
if {![drain_until 5 {expected after action}]} {
  puts stderr "action did not render expected state"
  exit 1
}
```

For mouse behavior, keep drag and release in separate logs. First prove the selection ANSI exists during drag. Then prove the same ANSI is absent after release. Derive coordinates and the expected selected substring from the captured viewport.

## Troubleshooting

- Capture shows only startup or footer: input arrived before the editor was ready. Wait for a scenario-owned marker and a stable editor/footer token.
- Expected token appears before the action: rotate the log after readiness to prevent a false positive.
- Expect exits zero with a missing marker: propagate required-wait failure and exit nonzero.
- `missing close-bracket`: replace raw `send "\033[C"` with `send -- "\033\[C"`.

Use [`python-ansi.md`](python-ansi.md) when the driver writes raw ANSI that needs structural assertions.
