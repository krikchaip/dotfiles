# Side Quests

Side Quests lets a parent Pi agent delegate complete tasks to sub-agents without blocking its current work.

- The **parent agent** performs the user's overall task, called the **main quest**.
- The parent agent spawns a **sub-agent** through `Agent` to perform a **side quest**.
- Each sub-agent runs in an interactive tmux pane and a persistent child session.
- You can watch, open, guide, stop, and resume a sub-agent.
- The parent agent reviews all returned side-quest work before it accepts the result.

Agent terms name actors. Quest terms name tasks. A side quest is not a sub-agent, session, process, or pane.

## Requirements

- Pi
- tmux
- A Pi session that is already running inside tmux

Outside tmux, Side Quests:

- Shows one startup warning.
- Registers no tools, commands, timers, or UI.
- Remains inactive.

Side Quests does not support cmux, Zellij, WezTerm, or a non-tmux fallback.

## How it works

```text
┌────────────── Parent agent · main quest ───────────┐
│ You and Pi continue the main task                  │
│                                                    │
│  Agent(...) ───────────────┐                       │
│                            │                       │
│  result + session path ◀───┼──────────────┐        │
└────────────────────────────┼──────────────┼────────┘
                             ▼              │
              ┌─── Shared sub-agent window ─┴─────────┐
              │ sub-agent  1 │ sub-agent  2 │ ...     │
              │ side quest 1 │ side quest 2 │         │
              └──────────────┴──────────────┴─────────┘
```

1. Start Pi inside tmux.
2. Ask Pi to delegate a clear, independent outcome.
3. The parent agent calls `Agent` and starts a sub-agent in a child Pi session.
4. Continue the main quest while the sub-agent works on its side quest.
5. Watch progress in the Side Quests widget.
6. Review the result when it returns to the parent agent.

Side quests are optional. The parent agent can delegate one when useful, even when you do not ask for one directly.

A good side quest has:

- One coherent objective
- A clear purpose
- Enough context to work independently
- Constraints that must stay true
- A return contract with acceptance evidence

Good examples:

- Research a topic and return a sourced synthesis or recommendation.
- Implement one feature and return its test results.
- Diagnose a bug and return the cause plus a verified fix.
- Compare two designs and return a recommendation with trade-offs.
- Audit a subsystem and return specific risks and evidence.

Do not use a side quest for granular helper work that the parent agent can do directly while it performs the main quest. Fetching a file, reading files, basic lookup, retrieval-only work, and search without a complete outcome stay with the parent agent. Search can support a side quest, but search cannot be its final objective.

## The `Agent` tool

Side Quests exposes one model tool named `Agent`.

```ts
{
  prompt: string;
  description: string;
  subagent_type?: string;
  resume?: string;
  inherit_context?: boolean;
  interactive?: boolean;
}
```

### Required fields

- `prompt` gives the child its objective, constraints, and return contract.
- `description` gives the pane and status row a short task label.
- Both values must contain text.
- A good `description` is two to six words, such as `audit auth permissions`.

### Optional fields

- `subagent_type` selects `general-purpose` or a named agent for a new launch.
- Omit `subagent_type` for the normal general-purpose form. Explicit `general-purpose` behaves identically.
- `resume` continues a saved sub-agent session by its absolute `session.jsonl` path.
- `inherit_context` controls whether a new child receives the parent conversation. It is valid only on a new launch.
- `interactive` controls whether a new child stays open after its current work ends. It is valid only on a new launch.

Unknown fields are rejected. An unknown or invalid `subagent_type`, or a disabled named agent, fails before Side Quests creates a pane or session. `Agent` does not accept per-call model, thinking, tools, skills, working directory, turn limit, system prompt, isolation, worktree, or background-mode settings.

### Launch a sub-agent for a new side quest

For a new side quest:

- `resume` is omitted.
- The standard agent clones the current parent model, thinking level, native prompt inputs, working directory, enabled tools, loaded extensions, and skills, then applies any resolved `general-purpose.md` customization.
- A call-level `inherit_context` overrides the resolved agent setting. If both are omitted, it defaults to `true`.
- A call-level `interactive` overrides the resolved agent setting. If both are omitted, it defaults to `false`.
- `prompt` is stored as a normal user message after any inherited conversation. With fresh context, it is the child's first conversation message.

`Agent` returns only after:

- The tmux pane has started.
- The child Pi process has started.
- The persistent child session file exists.

The response includes the canonical session path. The parent agent can continue the main quest immediately. `Agent` never waits for completion.

### Continue or resume a sub-agent

Pass the returned session path through `resume`:

```ts
{
  prompt: "Apply the review feedback and rerun the focused tests.",
  description: "apply review feedback",
  resume: "/absolute/path/to/session.jsonl"
}
```

When `resume` is present:

- `prompt` is the continuation message.
- `description` becomes the current task label.
- `subagent_type` is rejected because the saved session already owns its identity.
- `inherit_context` is rejected because the saved session already owns its conversation choice.
- `interactive` is rejected because the saved session already owns its lifecycle.

The whole call fails if any of these new-launch-only fields is present. Resume cannot change identity, context choice, lifecycle, capabilities, or prompt policy.

Every `Agent.resume` prompt is stored as a custom continuation message, not as a user-authored message. Delivery depends on child state:

- **Live and idle:** the child receives the custom message immediately.
- **Live and active:** the custom message is queued until the current tool batch finishes, without interruption.
- **Stopped:** Side Quests reopens the saved session in a new pane and delivers the custom message as its first continuation.
- **Already live:** Side Quests never starts a duplicate process for the same session.

The acknowledgement states whether Side Quests launched, continued, or reopened the child. It always includes the canonical session path.

Its structured details contain:

- Operation: new launch, live continuation, or reopened resume
- Current running status
- Canonical session path

## Agent definitions

Agent definitions give general-purpose and named sub-agents reusable instructions and capability policy.

Side Quests discovers Markdown files from:

- Project: `.pi/agents/*.md`
- Global: `$PI_CODING_AGENT_DIR/agents/*.md`
- Default global root: `~/.pi/agent/agents/*.md`

It does not scan `.agents/agents/` and does not include bundled agents.

### General-purpose configuration

General-purpose delegation is always available. Omitted `subagent_type` and explicit `general-purpose` behave identically.

- Without a winning `general-purpose.md`, the child is a plain clone of the parent setup.
- Project `.pi/agents/general-purpose.md` shadows the global file.
- A valid file supports the same model, thinking, tools, skills, context, lifecycle, display-name, and Markdown-body overrides as a named agent.
- `description` is optional because the standard agent does not need selection guidance.
- A malformed winning file warns once and rejects general-purpose launches. It never falls back to the global file or plain clone.
- `enabled: false` in either scope removes that customization and restores the plain parent clone. A project tombstone also shadows global customization. It never disables the standard agent.

### Named-agent names and precedence

- The case-sensitive filename stem is the agent name.
- `.pi/agents/security.md` defines `security`.
- A project file shadows a global file with the same name.
- Shadowing happens before validation.
- A broken project file does not fall back to the global file.
- A valid enabled file needs a non-empty `description`. Its Markdown body is optional.
- A broken winning file is excluded and produces one path-specific warning.
- `enabled: false` disables that name and can act as a project tombstone. A tombstone needs no description or body.
- `general-purpose` is reserved for the standard agent and follows the special rules above.

Pi receives each valid non-general-purpose agent's canonical name and full whitespace-normalized description in the system prompt's **Guidelines** section. The `subagent_type` choices always include `general-purpose` and update after `/reload`.

### Agent file example

```markdown
---
description: Review changes for security and permission risks
display_name: Security reviewer
enabled: true
model: openai-codex/gpt-5.6-sol
thinking: high
tools: [read, grep, find]
disallowed_tools: [bash, edit, write]
available_skills: false
preload_skills: [secure-code-review]
inherit_context: false
interactive: false
---

Return findings with file paths, severity, and evidence.
```

Supported frontmatter:

```yaml
description: Full role and delegation guidance
display_name: Friendly UI label
enabled: true
model: provider/model-id
thinking: off | minimal | low | medium | high | xhigh | max
tools: all | none | name, name | [name, name]
disallowed_tools: name, name | [name, name]
available_skills: true | false | [name, name]
preload_skills: [name, name]
inherit_context: true
interactive: false
```

Unknown frontmatter is ignored. This lets one agent file work with other extensions without errors.

### Agent identity, role, and task label

Three values have different jobs:

- **Filename:** the permanent agent identity used by `Agent.subagent_type`. For example, `security.md` defines `security`.
- **Frontmatter `display_name`:** the reusable role label shown in panes and widgets. For example, `Security reviewer`.
- **`Agent.description`:** the current task label supplied for each launch or continuation. For example, `audit auth permissions`.

The UI combines the role label and task label:

```text
Security reviewer — audit auth permissions · autonomous
└── display_name    └── Agent.description
```

`display_name` stays with the named agent. `Agent.description` can change each time the parent agent continues or reopens the sub-agent session.

Two other description fields guide the child:

- Frontmatter `description` tells the parent agent when and why to select this agent. It cannot be empty for a non-general-purpose agent and is optional for `general-purpose`.
- The Markdown body gives the selected child its agent-specific instructions.

### How child instructions are assembled

Side Quests builds the child's instructions in this order:

1. Pi adds its standard instructions and the inherited parent configuration.
2. Side Quests adds the full instructions for each `preload_skills` entry.
3. Side Quests adds the agent file's Markdown body.

For the example above, the child receives Pi's standard instructions first, the full `secure-code-review` skill second, and `Return findings with file paths, severity, and evidence.` last.

### Model and thinking

- Omitted values inherit the parent's current model and thinking level.
- `model` must match one exact `provider/model-id` from Pi's registry.
- Bare IDs, aliases, globs, and fuzzy matches are rejected.
- Invalid explicit values stop launch instead of falling back.
- Unsupported valid thinking levels use Pi's normal model-specific clamp.

### Tools and permissions

- Omitted `tools` inherits the parent's enabled tools.
- `tools: all` selects all registered child tools.
- `tools: none` selects no normal tools.
- A list selects exact registered tool names.
- `disallowed_tools` removes tools after the allowlist is applied.
- Unknown tool names stop launch.

Every child also follows two fixed safety rules:

- `Agent` and all other known subagent-spawning tools are always denied.
- `ask_parent` is always registered and enabled, even when the agent file denies it.

A child's resolved tool policy is saved in its manifest. Interactive takeover, continuation, resume, changed parent settings, and changed agent files never broaden that policy. If a required registered tool is missing when the session reopens, resume reports an error instead of using a broader fallback.

### Skills

`available_skills` controls skills that the child can load when needed:

- Omitted: inherit the parent's current lazy skill catalog.
- `true`: use all normally model-invocable skills discovered by the child.
- `false`: provide no lazy skill catalog.
- A list: provide exactly those discovered skill names, including an explicitly named skill that is normally hidden from model invocation.

`preload_skills` loads full skill instructions before the child starts:

- It is separate from `available_skills`.
- It can select a skill that is normally hidden from model invocation.
- A preloaded skill is removed from the lazy catalog to avoid duplication.
- An unknown skill name stops launch.

If the child does not have `read`, Side Quests omits a non-empty lazy skill catalog and shows a launch warning. Preloaded skill instructions still work.

### Context and working directory

- Context inheritance copies the parent conversation once at launch.
- Later parent messages are not synchronized automatically.
- Use `inherit_context: false` for an independent review, adversarial review, second opinion, or unrelated task.
- Every new child starts in the parent agent's current working directory at invocation time.
- Agent files and `Agent` calls cannot override the working directory.

Every child inherits the parent's loaded extensions. Side Quests remains child-safe: parent orchestration is inactive, while the child companion handles identity, activity, communication, and lifecycle.

## Tmux windows and panes

Each parent agent session owns one shared sub-agent window.

- Side Quests creates the window on the first launch.
- The window name uses the first segment of the parent session UUID as a short display label.
- Side Quests records the complete parent session ID and canonical tmux window ID. This makes sure it manages only that session's window and panes.
- Each live child gets one pane in that window.
- New and reopened panes start detached.
- Pi starts directly as the pane process in the parent agent's current working directory.
- Side Quests does not start an intermediate shell, replay terminal keystrokes, or wait for a shell-ready delay.
- Starting or resuming a sub-agent does not switch panes. You remain with the parent agent.
- Use `/side-quests` to select and open a child pane.

When the last managed pane closes:

- Side Quests removes the window if no user-created pane remains.
- It keeps the window if an unmanaged pane remains.
- It never kills a user-created pane to remove the window.

### Pane layouts

Side Quests supports two layout modes:

- `binary` uses two-way splits. This is the default.
- `ternary` uses three-way splits.
- An invalid configured mode produces one warning and uses `binary`.

Side Quests keeps pane placement predictable and adapts it to wide or tall windows.

- The layout updates when a managed child starts or stops, after `/reload`, and when the window size changes.
- Existing pane processes keep running during a layout update.
- User-created panes are included and never deleted.
- A manual split stays as you made it until the next automatic layout update.
- If the window is too small for a valid layout, Side Quests keeps the current arrangement and retries after the size or pane count changes.

## Parent status and navigation

The parent widget appears above the editor while live children exist:

```text
╭─ Side Quests · 2 live ────────────────────────────────────────────╮
│  00:00:42  Security reviewer — audit auth  active · reply needed  │
│  00:00:18  general — reproduce UI bug      waiting                │
╰───────────────────────────────────────────────────────────────────╯
```

Each row shows:

- Elapsed time as `HH:MM:SS`
- Agent display name or canonical name
- Current task label from `Agent.description`
- Activity state in the right-side column

Long task labels are shortened first on narrow terminals. Agent identity and lifecycle state remain visible.

Activity states:

- `starting`: the pane exists and the child is starting.
- `active`: the child is processing model or tool work.
- `waiting`: the child is idle or waiting for parent guidance.
- `stalled`: the child's health snapshot is missing, invalid, mismatched, or stale for 60 seconds.

`reply needed` appears after the activity state when a child has an unanswered request, such as `active · reply needed`. It does not replace `starting`, `active`, `waiting`, or `stalled`.

Completion and terminal failure are result messages, not permanent widget rows. A recoverable interactive turn failure returns its live row to `waiting`. The widget remains visible whenever at least one child is live; there is no status-visibility toggle.

### `/side-quests`

Run `/side-quests` to navigate live rows. If no child is live, Pi shows a notification and returns to the editor.

Navigation marks the selected row and displays key hints from your effective Pi bindings instead of hard-coded labels:

- `tui.select.up` and `tui.select.down` move the selected row.
- `tui.select.confirm` jumps the invoking tmux client to that pane.
- `tui.select.cancel` returns to the editor.
- `d` asks for confirmation before it closes the selected child.

The parent widget has no interrupt action. To interrupt one child, open that child pane and use Pi's normal effective `app.interrupt` action.

## Child identity and lifecycle

Every child pane shows one compact identity box above its editor:

```text
╭─ Security reviewer ────────────────────────────────╮
│  00:13:14  audit auth  autonomous · reply pending  │
╰────────────────────────────────────────────────────╯
```

The box shows:

- Agent display name, or canonical name when no display name exists, in the title
- Elapsed time as `HH:MM:SS`
- Current `Agent.description`
- `autonomous` or `interactive`
- `reply pending` when a parent response is pending

### Autonomous children

- Autonomous is the default lifecycle.
- The pane closes after normal autonomous completion, even when an `ask_parent` response is pending.
- An unanswered request remains saved after the child completes or closes.
- Long work does not become stalled only because it takes a long time.
- `/subagent-done` is not registered or shown while the child remains autonomous.

### Interactive children

- `interactive: true` starts a persistent pane and registers `/subagent-done` immediately.
- The pane stays open after an agent turn ends.
- Tool permissions stay unchanged during takeover.
- Use `/subagent-done` when the work is complete.

After creation, only one action permanently promotes an autonomous child to interactive:

- Submit an accepted, non-command prompt directly in the live child terminal.

These actions do not promote it:

- Typing or editing without submission
- Pasting or navigation
- Running an extension command
- Any `Agent.resume` continuation
- Receiving any other extension-injected message

### `/subagent-done`

`/subagent-done` is a user command for finishing interactive child work. It is not a model tool and is never registered in the parent.

Command availability follows the child's current persisted lifecycle:

- A child launched with `interactive: true` registers the command during startup.
- An autonomous child does not register or show the command.
- When an autonomous child accepts a direct non-command prompt, it becomes interactive and registers the command immediately, even though the new turn is active.
- Interactive state and command availability survive `/reload` and session reopen. Resume cannot change or demote lifecycle.

The command takes no arguments:

- While idle, `/subagent-done` atomically writes a trusted completion marker, sends the final assistant response to the parent as a completion result, and shuts down the child. The saved session remains resumable.
- An unanswered `ask_parent` request does not block completion. The request remains saved after the pane closes.

If the user types `/subagent-done` or `/subagent-done anything` while the child is autonomous, Side Quests shows that the command is available only in interactive mode. The text does not reach the model, complete the child, or promote it to interactive mode.

## Asking the parent for help

Every child has an `ask_parent` tool.

Use it when the sub-agent needs information or a decision from the parent agent:

```tex
sub-agent sends ask_parent ─────► parent agent wakes with reply needed
         │                                  │
         ▼                                  ▼
continues its side quest            answers with Agent.resume
         │                                  │
         └──────── receives custom reply ◄──┘
```

Rules:

- A child can have only one unanswered request.
- The first `ask_parent` call writes the request and returns normally.
- Other tools in the same batch still run.
- The child continues work without waiting for the answer.
- Another `ask_parent` call fails until the first request is answered.
- The request remains saved if the child completes or closes first.

The parent agent answers through `Agent.resume` only. The answer is a persisted custom message:

- A live idle child receives it immediately.
- A live active child receives it after its current tool batch, without interruption.
- A stopped child reopens and receives it as its first continuation.
- The request clears only after the matching response is accepted.

Lifecycle and parent-request state are independent. An interactive terminal prompt can start more work while a parent request remains pending. It does not cancel the request.

## Health monitoring

The child writes a small activity snapshot and heartbeat. The parent checks child snapshots and canonical tmux pane IDs once per second.

A child becomes `stalled` after 60 seconds when its snapshot:

- Never appears
- Is missing or invalid
- Names the wrong child
- Has a stale heartbeat

A current heartbeat keeps long-running work healthy. Side Quests does not use task duration or transcript inactivity as a progress timeout.

### Autonomous child health events

When an autonomous child first becomes `stalled`, its parent row changes to `stalled` and Side Quests sends one persisted stall event to the parent agent. That event starts or queues a parent agent turn. The event identifies the child and explains the health failure, such as a heartbeat that has been stale for 60 seconds.

Side Quests does not restart, interrupt, resume, or close the child automatically. The parent agent can respond to the event with the tools available to it. For example, it can send guidance through `Agent.resume`, launch another child as a fallback, report the problem, or take no action and continue waiting. Sending guidance does not repair a frozen process, and launching a fallback does not close the stalled child.

If the child later writes a valid snapshot with a current heartbeat, its row returns to `active` or `waiting`. Side Quests then sends one persisted recovery event and wakes the parent agent once for that `stalled`-to-healthy transition. This can tell the parent that an original child recovered after it launched a fallback or changed its plan. Later healthy heartbeats do not cause more parent turns. A new stall can produce a new stall event and a later recovery event.

For example, a stopped child process can miss heartbeats for 60 seconds and become `stalled`. If the process resumes, its next current heartbeat marks it healthy and produces one recovery event. A long model or tool operation does not stall while the heartbeat remains current.

### Interactive child health events

Interactive children use the same snapshot checks, 60-second threshold, and widget transitions. They do not use the same parent-wake behavior. A stall changes the row to `stalled`, and recovery changes it back to `active` or `waiting`, but neither transition starts a parent agent turn.

The user controls an interactive child directly in its pane. Widget-only health changes avoid injecting an unexpected parent turn during that manual work.

## Results and terminal states

Side Quests delivers each trusted terminal event to the parent agent at most once. Completion and terminal failure wake the parent agent so it can run the side-quest review loop. A recoverable turn failure in a live interactive child is not terminal and remains local to that pane. A terminal result includes the canonical session path when available.

### Result display

Result messages support collapsed and expanded views:

- The default view is collapsed.
- Clear status text distinguishes success, failure, cancellation, and closure.
- The expanded view shows additional result details.
- Pi's normal `app.tools.expand` action controls expansion.
- The hint displays your effective binding.
- Side Quests does not register or show a hard-coded expansion shortcut.

### Completed

A completed result has two sources:

- An autonomous child reaches normal agent completion. Side Quests records completion and closes its pane automatically.
- An idle interactive child receives `/subagent-done`. Side Quests records trusted completion and closes its pane explicitly. The end of an ordinary interactive agent turn alone does not produce completion because its pane remains available for more work.

Both paths wake the parent agent once, return the child's final assistant response, and include the canonical session path. The saved session remains available for later resume, but the full child transcript is not copied into the parent session. An unanswered `ask_parent` request remains saved and does not prevent completion.

### Failed

Failure handling depends on whether the child can continue.

#### Autonomous turn failure

An exhausted provider or agent-loop error ends autonomous work. Side Quests records a terminal failed result, closes the child, removes its widget row, and wakes the parent agent:

```text
Sub-agent failed
Security reviewer — audit auth
Error: Provider request failed: rate limit exceeded
Resume: /managed/path/to/session.jsonl
```

The error and canonical session path let the parent report the problem, start another child, or call `Agent.resume` to retry from the saved conversation.

#### Interactive turn failure

A provider or agent-loop error ends only the current turn when the interactive Pi process remains healthy. The error stays visible in the child pane, the pane remains open, and its widget row returns to `waiting`. Side Quests does not send a failed result or wake the parent agent.

```text
provider or agent-loop error
        ↓
error remains visible in the interactive child pane
        ↓
pane stays open · widget shows waiting
        ↓
user retries, changes the prompt, or later uses /subagent-done
```

If the user retries successfully and then runs `/subagent-done`, the parent receives a completed result from that explicit completion.

#### Terminal process failure

A fatal or nonzero child-process exit is terminal for both autonomous and interactive children because the pane can no longer continue. Side Quests removes the row and wakes the parent with a failed result. If the current run produced an assistant response before exit, the result includes it as diagnostic context but remains failed:

```text
Sub-agent failed
Security reviewer — audit auth
Error: Child process exited with status 1
Last response from this run: Found an unsafe token fallback in src/auth.ts.
Resume: /managed/path/to/session.jsonl
```

Side Quests never substitutes an old response for a terminal failed run. For example:

1. An earlier turn ends with `No auth issues found.`
2. The parent resumes the child with `Check refresh-token rotation.`
3. The provider fails before an autonomous child produces a new response, or an interactive child process exits.
4. The parent receives the new error and resume path. It does not receive `No auth issues found.` as if that were the result of the new request.

### Cancelled

- A confirmed close from `/side-quests` writes a trusted cancellation state.
- The saved session remains resumable.

### Closed

`closed` means the pane disappeared without a trusted completion, cancellation, error, or expected parent-shutdown marker.

Examples include:

- `/quit` or EOF inside the child
- `tmux kill-pane`
- Whole-window removal
- A clean process exit without semantic completion
- An uncaptured crash

The parent monitor polls snapshots and tmux pane IDs once per second. After a pane disappears, it waits one more poll for a child terminal marker. A marker produces `completed`, `failed`, or `cancelled`; otherwise the parent reports `closed` and wakes the model. A `closed` result can include the final assistant response but never claims completion or a cause. It states when an unanswered `ask_parent` request remains saved.

A closed child:

- Wakes the parent.
- Leaves the saved session resumable.
- Preserves an unanswered parent-request mailbox.
- Disappears from the live widget.
- Causes remaining panes to reflow.

## Reload, exit, and crash behavior

### `/reload`

`/reload` hands live children to the new extension instance:

- Child processes and panes stay alive.
- The old widget and poller stop.
- The new instance validates and adopts the same owned children.
- Pending terminal events are handled before the first restored widget is rendered.
- The widget, polling, and layout are rebuilt.
- Agent-file changes apply only to new children.
- Existing children keep their saved manifest policy.
- Events written during reload are delivered once.
- Already delivered events are not duplicated.
- Focus stays on the parent agent's pane.

### Parent agent exit or session replacement

On quit, `/new`, `/resume`, `/fork`, or `/clone`:

- Side Quests marks shutdown as expected.
- Every child owned by that parent agent session stops.
- Managed panes close.
- No misleading child completion handoff is emitted.
- Saved child sessions remain available.

### Abrupt parent loss

Children monitor both:

- The unique parent process identity
- A lease renewed by the parent poller

If the parent process dies, children stop. If reload removes or breaks Side Quests, the lease expires after its default 60-second grace period and children stop even when the parent Pi process remains alive. This prevents orphan child processes.

## Session storage and resume safety

Side Quests stores data outside Pi's normal session tree:

```text
$PI_CODING_AGENT_DIR/side-quests/
├── sessions/<parent-session-uuid>/<child-session-uuid>/
│   ├── session.jsonl
│   ├── manifest.json
│   └── mailbox/
│       ├── request.json
│       └── response.json
└── runtime/<parent-session-uuid>/
    ├── owner.json
    └── children/<child-session-uuid>/
        ├── activity.json
        └── terminal.json
```

Persistent data:

- `session.jsonl` contains the Pi child session.
- `manifest.json` contains identity, lineage, CWD, lifecycle, model, thinking, exact tools, skills, prompt policy, and schema version.
- Resume cannot change resolved identity, context choice, lifecycle, capabilities, or prompt policy.
- Continuation can update only the task label. Human terminal takeover can persist permanent lifecycle promotion.
- Unanswered requests remain until they receive a matching response.

Replaceable runtime data:

- Tracks owner health, pane ownership, current activity, and trusted terminal state.
- Can be cleaned after the recorded owner process and lease are both dead.

Resume safety:

- The absolute `session.jsonl` path is the canonical child identifier.
- The path must be a regular managed file under the Side Quests root.
- Real path, directory IDs, manifest IDs, and parent lineage must agree.
- Missing files, malformed manifests, foreign sessions, and symlink escapes are rejected.
- Resuming never opens an arbitrary file as a Pi session.

Storage safety:

- Directories and files use owner-only access.
- Manifests, mailboxes, activity, owner, and terminal files use atomic replacement.
- IDs and schema versions are validated before use.
- Responses are removed after the child accepts them.
- Session files and unanswered requests have no automatic expiry.
- Closing, failure, cancellation, shutdown, or reload does not delete a session.

Sub-agent sessions do not appear in Pi's normal `/resume` list. Resume them only through `Agent.resume` with the path returned to the parent agent.

## Safety boundaries

Side Quests:

- Launches Pi children only.
- Never launches Claude Code or another agent runtime.
- Prevents nested sub-agents.
- Never gives a child a spawning tool.
- Keeps child permissions fixed across takeover and resume.
- Preserves unmanaged tmux panes and their processes.
- Does not broadcast parent interruption to children.
- Stops owned children when their owner disappears.
- Keeps saved sessions until explicit deletion.
- Requires the parent agent to review returned evidence or changes.

## Not included

Side Quests does not include:

- Synchronous or foreground `Agent` calls
- `run_in_background` or a foreground/background switch
- Result-polling, steering, or parent interrupt tools
- Mandatory delegation or an orchestrator
- Task queues, groups, scheduling, or nested agents
- Worktree or isolation management
- Per-call model, tools, skills, thinking, CWD, prompt, or turn-limit controls
- Bundled agents, cross-session agent memory, or fuzzy model matching
- Alternate transcripts or ephemeral child sessions
- Automatic age-based cleanup or a session-deletion UI
- A human surface for reopening a stopped autonomous session as interactive
- A dense fleet dashboard or a child tool-list widget
