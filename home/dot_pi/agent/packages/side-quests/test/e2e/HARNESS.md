# Side Quests end-to-end harness

## Mental model

Only the model is fake. The test runs the real Pi TUI, Side Quests extension, tmux panes, parent and child processes, filesystem storage, keyboard input, and terminal output.

```text
run.ts
  -> starts one E2EHarness per scenario
     -> starts Pi in an isolated tmux server
     -> loads the real Side Quests extension
     -> loads the deterministic model provider
     -> gives the scenario control
        -> sends terminal input
        -> waits for visible or stored evidence
        -> asserts the user journey
```

Tmux provides the real PTY and replaces the old Expect harness. Scenarios run in parallel by default, but each scenario uses a separate tmux server, Pi state directory, working directory, and artifact set.

## Required programs

- Bun
- Pi
- tmux
- chezmoi

The fake provider comes from `@earendil-works/pi-ai` in the package dependencies.

## File responsibilities

### `run.ts`

The central entrypoint:

1. Applies the runtime extension with chezmoi.
2. Creates one temporary run directory and one isolated tmux socket per scenario.
3. Selects scenarios.
4. Runs scenarios through a bounded parallel worker pool with one watchdog per scenario.
5. Runs exclusive timing scenarios without other active scenario workers.
6. Stops active workers on the first failure, then cleans resources or keeps artifacts.

`SIDE_QUESTS_E2E_MODES` filters managed scenarios. The runner always includes the first three startup checks: `outside`, `parent`, and `child`.

### `harness.ts`

`E2EHarness` owns one scenario's real Pi process and tmux PTY. It provides four groups of operations:

- Input: `sendParent()`, `sendLiteral()`, and `sendKeys()`
- Terminal observation: `capture()`, `waitFor()`, and `waitUntil()`
- Process topology: `childPane()`, `childPanes()`, and `tmux()`
- Storage observation: `filesNamed()`, `read()`, and `waitForStoredText()`

It also checks clean process exit, flushed ANSI output, expected tmux warnings, retained managed sessions, and extension startup errors.

### `provider.ts`

This registers the deterministic `side-quests-e2e/fake` model. It reads `SIDE_QUESTS_E2E_SCENARIO`, finds that scenario in `scenarios.ts`, and calls its `configureProvider()` function.

The provider chooses the response queue by process role:

```ts
process.env.PI_SIDE_QUESTS_CHILD_ID ? "child" : "parent";
```

Both the parent and child load the same provider module, but each gets its own configured responses.

### `scenarios.ts`

This is the scenario registry. `scenarioByName()` gives the runner and provider one exact lookup path.

### `types.d.ts`

This declares the E2E types globally for modules under `test/e2e/`:

- `Scenario`
- `ScenarioProcess`
- `ProviderContext`
- `Faux`

Scenario files do not import these types.

### `provider-support.ts`

This contains reusable fake-model response flows, including basic delegation, continuation, and reopening a stopped child.

### `persistent-state-storage.ts`

This contains filesystem assertions specific to the persistent-state scenario.

### `scenario/*.ts`

This folder contains only test cases. Each file defines one user journey as a `Scenario` object.

## Scenario contract

```ts
interface Scenario {
  readonly name: string;
  readonly exclusive?: boolean;
  readonly process: ScenarioProcess;
  readonly timeoutMs?: number;
  readonly width?: number;
  configureProvider?(context: ProviderContext): void;
  run(harness: E2EHarness): Promise<void>;
}
```

`configureProvider()` defines deterministic parent and child model replies. `run()` drives the real terminal and checks the result. Set `exclusive` only for machine-level timing scenarios whose measurements would be invalid under parallel test load.

Common `process` options:

| Option              | Effect                                                   |
| ------------------- | -------------------------------------------------------- |
| `managed`           | Enables the fake model and managed child flow            |
| `child`             | Starts directly in child mode                            |
| `extensionFixtures` | Auto-loads fixtures in both parent and managed child Pi  |
| `extensionsBefore`  | Loads parent-only fixtures before the package entrypoint |
| `outsideTmux`       | Removes tmux environment variables                       |
| `positionalPrompt`  | Gives Pi an initial prompt                               |
| `lifecycle`         | Selects interactive lifecycle behavior                   |
| `settings`          | Writes isolated Pi settings                              |

## General execution flow

### 1. Select and isolate

`run.ts` creates a temporary directory. Each scenario gets its own tmux socket, working directory, Pi state directory, status file, ANSI log, and launch script.

```text
run directory/
  N.sock
  scenario-cwd/
  scenario-state/
  scenario-launch.sh
  scenario.status
  scenario.ansi
  scenario.ansi.done
```

The isolated `PI_CODING_AGENT_DIR` prevents user settings and sessions from affecting the test.

### 2. Start Pi without losing startup output

The generated launch script waits for a gate file. The harness starts the tmux pane, attaches `tmux pipe-pane`, and then creates the gate file. Pi cannot emit output before capture is ready.

When the pane closes, the pipe writes `scenario.ansi.done`. The harness can then distinguish process exit from completed log flushing.

### 3. Configure model behavior

For managed scenarios, the harness writes a provider extension shim into the isolated Pi state directory. Pi loads `provider.ts` and uses `side-quests-e2e/fake` instead of a remote model.

The fake provider controls only model responses. Side Quests still performs real tool calls, child launches, mailbox writes, continuation delivery, and UI rendering.

### 4. Drive and assert the journey

The scenario sends terminal input and waits for evidence. Evidence can come from:

- The current parent or child terminal view
- Stored `session.jsonl` content
- Mailbox or runtime files
- Tmux pane and window properties
- Raw ANSI output

A wait fails with a current parent-pane capture when its deadline expires.

### 5. Finish and clean up

`finish()` sends Ctrl-D, waits for Pi's status file, waits for the ANSI flush marker, and checks generic invariants. The runner kills the isolated tmux server afterward.

Successful runs delete the temporary directory. Failed runs keep it and print its path for inspection.

## Small example

`scenario/lifecycle.ts` is the smallest managed journey:

```ts
export const lifecycle: Scenario = {
  name: "lifecycle",
  process: { managed: true },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness) {
    await harness.sendParent("Delegate this E2E task now.", true);
    await harness.waitFor("Subagent completed:");
  },
};
```

The parent fake model calls the real `Agent` tool. Side Quests starts a real child Pi pane. The child fake model returns its deterministic completion. The real child runtime reports completion to the real parent UI. The scenario passes only when that UI shows `Subagent completed:`.

## Complex parent-child flow

The `ask-parent` journey follows this path:

```text
parent prompt
  -> parent model calls Agent
  -> real Agent tool starts child Pi
  -> child model calls ask_parent
  -> real child writes request mailbox
  -> real parent shows the question
  -> parent model calls Agent with resume and answer
  -> real response mailbox delivers the answer
  -> child model returns its final response
  -> scenario checks stored session text and parent UI
```

## Commands

Run all scenarios with the default bounded parallelism:

```nu
bun run test:e2e
```

Set the worker count explicitly. Use `1` to reproduce sequential execution:

```nu
with-env { SIDE_QUESTS_E2E_JOBS: "2" } {
  bun run test:e2e
}
```

Run one managed scenario plus the three startup scenarios:

```nu
with-env { SIDE_QUESTS_E2E_MODES: "lifecycle" } {
  bun run test:e2e
}
```

Run multiple managed scenarios:

```nu
with-env { SIDE_QUESTS_E2E_MODES: "lifecycle ask-parent" } {
  bun run test:e2e
}
```

Run the opt-in real-model prompt behavior checks:

```nu
bun run test:prompt
```

`test:prompt` runs real Pi sessions in tmux with `antigravity/gemini-3.6-flash-medium`. It checks that normal context continuity omits `inherit_context` and intentional isolation sends `inherit_context: false`. Set `SIDE_QUESTS_PROMPT_MODEL` to test another configured model. This test is not part of `bun run test` because it needs a live model service and its output is probabilistic.

## Failure artifacts

The runner stops active scenarios after the first failure and prints the retained artifact directory. Inspect these first:

- `SCENARIO.ansi`: raw terminal output
- `SCENARIO.status`: Pi process exit status
- `SCENARIO-state/`: isolated Pi sessions, mailboxes, and runtime files
- `SCENARIO-launch.sh`: exact generated command and environment
