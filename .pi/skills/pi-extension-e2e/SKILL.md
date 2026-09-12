---
name: pi-extension-e2e
description: Reproduce and E2E-test Pi extension behavior in a test-owned live tmux session with the user's real configuration before automating the verified path. Use for Pi extensions, terminal UI patches, slash commands, keyboard/editor behavior, ANSI styling, viewport layout, or startup/runtime loading.
---

# Pi Extension E2E

A Pi extension is only proven when it runs inside the real interactive TUI. First reproduce the exact path live in a dedicated tmux session with the user's normal Pi configuration. Automate that observed path only after reproduction is stable. Select the automation driver from the evidence, not before it.

## Acceptance matrix

Before changing a user-visible Pi behavior, define one row for each reported path:

| Entry path | Required runtime stack | User action or native event | Expected observable result | Evidence |
| ---------- | ---------------------- | --------------------------- | -------------------------- | -------- |

- Keep the reported trigger. Do not replace an automatic event with a manual command.
- Include each named extension, theme, terminal, or configuration that affects the claim. A clean run is a baseline, not proof of a named integration.
- In the final report, name each exercised row. Mark every unrun in-scope row as `unverified`.

## Live reproduction gate

Do not create or edit an E2E test or test harness before this gate passes. For each acceptance row, reproduce the reported behavior or exact pre-change path in a real tmux session and save observable evidence. If the path does not reproduce, stop. Mark it `unverified` and ask for the missing runtime detail instead of guessing a test.

1. Match the user's runtime.
   - Record the reported cwd, terminal and tmux details, pane dimensions, `pi --version`, extension stack and load order, theme, settings, and relevant project resources.
   - Use the normal `PI_CODING_AGENT_DIR` and Pi resource discovery. Start with the user's configuration, not `--no-*` flags or a minimal synthetic config.
   - If the extension source lives in chezmoi and the runtime is expected to match it, run `chezmoi apply ~/.pi/...` before reproduction. Confirm that the runtime file matches the source.
   - Check which local packages the extension resolves before blaming the extension for a host-version mismatch. Never replace `node_modules` to make a test pass.

2. Open a test-owned tmux session.
   - Prefer a separate tmux server and socket such as `tmux -L pi-e2e-<test-id>`. Clear inherited `TMUX` and `TMUX_PANE` before creating that server.
   - A dedicated session on the user's existing tmux server is allowed only after the user approves it. Target only test-owned sessions, windows, and panes. Never type into, select, resize, close, or otherwise change an existing user pane.
   - Give every server, session, window, pane, log, cwd, and fixture one test ID. The run must not take focus. Abort if any action would target an object outside that ID.
   - Run Pi inside the tmux pane. Drive the exact user actions there and inspect the live pane with `tmux capture-pane`; use `PI_TUI_WRITE_LOG` when raw ANSI evidence is needed.

3. Reproduce with the real configuration.
   - Use the reported cwd when project resources or trust affect the path. Handle `Trust project folder?` explicitly and do not persist a trust choice unless the user asks.
   - Load the same extensions, skills, prompts, themes, settings, and adapters as the user. Confirm an observable effect from each required integration.
   - Preserve the reported terminal dimensions and exact key, mouse, resize, session, or lifecycle event sequence.
   - Capture the before state, trigger, after state, and enough pane or ANSI output to identify the behavior. Repeat the path to prove it is stable.

4. Keep reproduction model-free.
   - Prefer a temporary copied or generated `session.jsonl` fixture when prior user, assistant, tool, compaction, or custom entries can create the required state. Load it with `pi --session <fixture>` in the tmux pane. Never edit the user's original session file.
   - Prefer deterministic native events, extension commands, and test fixtures over sending a prompt. Keep the reported trigger; fixture setup must not replace the event under test.
   - Treat any provider request as a model call, including prompts, nested LLM work in extensions, compaction, and branch summaries. If a model call is the only way to reproduce the path, stop and ask the user for explicit approval and the exact provider/model to use. Do not infer or use the configured default.

5. Record the reproduction.
   - Save the tmux command, Pi command, fixture provenance, dimensions, exact input sequence, and observed result for each acceptance row.
   - Completion: the behavior is visible in a test-owned live tmux session and can be repeated from the recorded setup. Until then, no E2E test code is allowed.

## Automation loop

1. Transcribe the proven tmux path.
   - Automate every requested E2E row. The confirmation is required; its implementation language is not.
   - Choose the smallest driver that preserves the observed behavior: a tmux script, Bash, JavaScript, Expect, or another real-terminal driver.
   - Start from the live reproduction. Reduce configuration only one variable at a time, and rerun after each reduction. Keep every resource that changes the result.
   - Keep copied settings and session fixtures temporary or sanitized. Never commit user secrets or the user's original session.
   - For a bug, prove the automated scenario is known-red before changing production source.

2. Start Pi through the selected real-terminal harness.
   - Use deterministic terminal env where the scenario permits it: `TERM=xterm-256color COLORTERM=truecolor COLUMNS=<n> LINES=<n> PI_OFFLINE=1`.
   - Set the real pty or tmux pane size when viewport size matters.
   - An isolated cwd, temporary `PI_CODING_AGENT_DIR`, and `--no-session --no-context-files --no-prompt-templates --no-themes --no-extensions --no-skills` are automation reductions, not reproduction defaults. Use them only after live evidence proves the removed resources are irrelevant.
   - Load required extensions and resources explicitly and in the reproduced order. Explicit skills still load with `--no-skills`.
   - Test optional adapters in both modes: base extension alone, then base extension plus adapter.

3. Answer terminal probes, then wait for scenario-specific readiness.
   - Reply to `ESC[c` with `ESC[?1;2c`.
   - Reply to `ESC[?u` with `ESC[?0u`.
   - Use a short poll timeout until a fixed deadline.
   - Wait for an extension-owned marker and then a stable editor/footer token. `$0.000` is only an example; custom footers may never render it.
   - Treat a missing readiness pattern as test failure. Model names are not readiness evidence.

4. Drive and isolate the user-visible transition.
   - Send the exact terminal encoding from the live reproduction.
   - Rotate to a fresh log after readiness when expected text may already exist in startup output. Drain after each key burst.
   - Keep graphics-adapter startup and transition logs separate. Prefer narrow columns for wrapping, truncation, ellipsis, and key-hint scenarios.
   - Exit with Ctrl-C/Ctrl-D and close the pty or test-owned tmux session.

5. Assert on observable output.
   - Check behavior text and ANSI controls together when styling matters. Check both expected presence and unwanted absence.
   - Capture state transitions separately, such as highlighted during drag and plain after release.
   - For graphics wire proof, assert command, transport envelope, fallback absence, and cleanup scope.
   - The harness must exit nonzero when required evidence is absent. A completed Pi process alone is not a passing E2E test. Print a readable ANSI slice on failure.

## Graphics adapters: wire proof

Wire proof verifies bytes at a terminal-adapter boundary; pixel proof verifies a real emulator.

- Replay deterministic history long enough to cross the viewport. Use a captured production image when dimensions, placement, or scroll behavior matter.
- Make the capability boundary explicit in the selected driver: set `TMUX`, tmux-like `TERM`, and only required outer-terminal variables. Assert emitted bytes at this boundary.
- Label nested-pty evidence as wire proof. When pixel placement matters, add an interactive visual check in real tmux and terminal emulator.
- For non-BMP placeholders, assert neighboring stable evidence: placement APC, SGR foreground/underline metadata, structural UI text, and cleanup commands.
- Make every assertion layer fail closed, including non-ASCII byte checks.
- Delete temporary fixtures, sessions, logs, and isolated cwd after verification.

## Implementation references

After the live reproduction gate passes, read only the reference needed by the selected implementation:

- [Expect driver](references/expect.md) — pty harness, probe handling, input bytes, viewport capture, and Expect-specific failures.
- [Python ANSI assertions](references/python-ansi.md) — fail-closed text and ANSI checks for logs produced by any driver.

Bash, JavaScript, tmux-native, and other drivers are equally valid. Add a focused reference only when that implementation has reusable details that do not belong in the required workflow.

## Scenario checklist

Use this before calling E2E done:

- Acceptance matrix covers every in-scope reported path; each unrun row is marked `unverified`.
- Every automated row first reproduced live in a test-owned tmux session with the user's normal Pi configuration.
- Reproduction evidence records cwd, tmux and terminal details, dimensions, Pi version, resource stack, exact inputs, and observed output.
- No E2E test code was written before the live reproduction gate passed.
- No model call occurred without explicit user approval and an exact user-selected provider/model; model-free session fixtures were tried first.
- Extension/runtime source applied if needed. Pi and resolved dependency versions are known.
- Any automated config reduction was proven irrelevant one change at a time after reproduction.
- Harness uses a real pty or test-owned tmux session, deterministic env where valid, explicit extension loading in dependency order, and only proven-required resources.
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
- Every driver and assertion layer fails closed, including Unicode-safe byte checks.
- Narrow viewport run exists for wrapping/truncation/ellipsis/keyhint changes.
- Failure prints a readable slice and exits nonzero.
- Test-owned terminals, tmux servers, panes, logs, and fixtures are removed.
