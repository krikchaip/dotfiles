# Side Quests

Side Quests lets Pi delegate independent work to other Pi sessions without blocking your current session.

- Your current Pi session is the **main quest**.
- Each delegated Pi session is a **side quest**.
- Each side quest runs in an interactive tmux pane.
- You can watch, open, guide, stop, and resume a side quest.
- The main quest reviews all returned work before it accepts the result.

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
┌──────────────────── Main quest ────────────────────┐
│ You and Pi continue the main task                  │
│                                                    │
│  Agent(...) ───────────────┐                       │
│                            │                       │
│  result + session path ◀───┼──────────────┐        │
└────────────────────────────┼──────────────┼────────┘
                             ▼              │
              ┌──── Shared tmux window ─────┴───────┐
              │ side quest 1 │ side quest 2 │ ...   │
              │     Pi       │      Pi      │       │
              └──────────────┴──────────────┴───────┘
```

1. Start Pi inside tmux.
2. Ask Pi to delegate a clear, independent outcome.
3. Pi calls `Agent` and starts a child Pi session.
4. Continue your main task while the child works.
5. Watch progress in the Side Quests widget.
6. Review the result when it returns to the main quest.

Side quests are optional. Pi can start one when delegation is useful, even when you do not ask for one directly.

A good side quest has:

- One coherent objective
- A clear purpose
- Enough context to work independently
- Constraints that must stay true
- A return contract with acceptance evidence

Good examples:

- Implement one feature and return its test results.
- Diagnose a bug and return the cause plus a verified fix.
- Compare two designs and return a recommendation with trade-offs.
- Audit a subsystem and return specific risks and evidence.

Do not use a side quest for granular helper work that the main quest can do directly. Retrieval-only work stays in the main quest. Search can support a side quest, but search cannot be its final objective.

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

- `subagent_type` selects a named agent.
- Omit `subagent_type` for a general-purpose copy of the parent setup.
- `resume` continues a saved side quest by its absolute `session.jsonl` path.
- `inherit_context` controls whether a new child receives the parent conversation.
- `interactive` controls whether the child stays open after its current work ends.

Unknown fields are rejected. An unknown, disabled, or invalid `subagent_type` fails before Side Quests creates a pane or session. `Agent` does not accept per-call model, thinking, tools, skills, working directory, turn limit, system prompt, isolation, worktree, or background-mode settings.

### New side quest

For a new side quest:

- `resume` is omitted.
- `subagent_type` can select a named agent.
- Omitted `subagent_type` clones the current parent model, thinking level, native prompt inputs, working directory, enabled tools, loaded extensions, and skills.
- A call-level `inherit_context` overrides the named agent setting. If both are omitted, it defaults to `true`.
- A call-level `interactive` overrides the named agent setting. If both are omitted, it defaults to `false`.

`Agent` returns only after:

- The tmux pane has started.
- The child Pi process has started.
- The persistent child session file exists.

The response includes the canonical session path. The main quest can continue immediately. `Agent` never waits for completion.

### Continue or resume a side quest

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
- `inherit_context` is rejected because the saved session already owns its conversation.
- Omitted `interactive` keeps the current lifecycle mode.
- `interactive: true` permanently promotes the session.
- `interactive: false` cannot demote an interactive session.

Continuation behavior depends on child state:

- **Live and idle:** the child receives the message immediately.
- **Live and active:** the child receives it after the current tool batch, without interruption.
- **Stopped:** Side Quests reopens the saved session in a new pane and sends the message.
- **Already live:** Side Quests never starts a duplicate process for the same session.

The acknowledgement states whether Side Quests launched, continued, or reopened the child. It always includes the canonical session path.

Its structured details contain:

- Operation: new launch, live continuation, or reopened resume
- Current running status
- Canonical session path

## Named agents

Named agents give side quests a reusable role and capability policy.

Side Quests discovers Markdown files from:

- Project: `.pi/agents/*.md`
- Global: `$PI_CODING_AGENT_DIR/agents/*.md`
- Default global root: `~/.pi/agent/agents/*.md`

It does not scan `.agents/agents/` and does not include bundled agents.

### Names and precedence

- The case-sensitive filename stem is the agent name.
- `.pi/agents/security.md` defines `security`.
- A project file shadows a global file with the same name.
- Shadowing happens before validation.
- A broken project file does not fall back to the global file.
- A valid enabled file needs a non-empty `description`. Its Markdown body is optional.
- A broken winning file is excluded and produces one path-specific warning.
- `enabled: false` disables that name and can act as a project tombstone. A tombstone needs no description or body.
- `default.md` does not replace the general-purpose parent clone.

Pi receives the full description of each valid agent in its system prompt. The `subagent_type` choices update after `/reload`.

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

`display_name` stays with the named agent. `Agent.description` can change each time the main quest continues or reopens the session.

Two other description fields guide the child:

- Frontmatter `description` tells the parent model when and why to select this agent. It cannot be empty.
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
- Every new child starts in the main quest's current working directory at invocation time.
- Agent files and `Agent` calls cannot override the working directory.

Every child inherits the parent's loaded extensions. Side Quests remains child-safe: parent orchestration is inactive, while the child companion handles identity, activity, communication, and lifecycle.

## Tmux windows and panes

Each main quest owns one shared side-quest window.

- Side Quests creates the window on the first launch.
- The window name uses the first segment of the parent session UUID as a short display label.
- Side Quests records the complete parent session ID and canonical tmux window ID. This makes sure it manages only that session's window and panes.
- Each live child gets one pane in that window.
- New and reopened panes start detached.
- Pi starts directly as the pane process in the main quest's current working directory.
- Side Quests does not start an intermediate shell, replay terminal keystrokes, or wait for a shell-ready delay.
- Starting or resuming a side quest does not switch panes. You remain in the main quest.
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
╭─ Side Quests · 2 live ───────────────────────────╮
│  00:42  Security reviewer — audit auth    active │
│  00:18  general — reproduce UI bug       waiting │
╰──────────────────────────────────────────────────╯
```

Each row shows:

- Elapsed time
- Agent display name or canonical name
- Current task label from `Agent.description`
- Right-aligned activity state

Long task labels are shortened first on narrow terminals. Agent identity and lifecycle state remain visible.

Activity states:

- `starting`: the pane exists and the child is starting.
- `active`: the child is processing model or tool work.
- `waiting`: the child is idle or waiting for parent guidance.
- `stalled`: the child's health snapshot is missing, invalid, mismatched, or stale for 60 seconds.

Completion and failure are result messages, not permanent widget rows. The widget remains visible whenever at least one child is live; there is no status-visibility toggle.

### `/side-quests`

Run `/side-quests` to navigate live rows. If no child is live, Pi shows a notification and returns to the editor.

Navigation marks the selected row and displays key hints from your effective Pi bindings instead of hard-coded labels:

- `tui.select.up` and `tui.select.down` move the selected row.
- `tui.select.confirm` jumps the invoking tmux client to that pane.
- `tui.select.cancel` returns to the editor.
- `d` asks for confirmation before it closes the selected child.

The parent widget has no interrupt action. To interrupt one child, open that child pane and use Pi's normal effective `app.interrupt` action.

## Child identity and lifecycle

Every child pane shows one compact identity line above its editor:

```text
Security reviewer — audit auth · autonomous · awaiting parent
```

The line shows:

- Agent display name, or canonical name when no display name exists
- Current `Agent.description`
- `autonomous` or `interactive`
- `awaiting parent` when a question is pending

### Autonomous children

- Autonomous is the default lifecycle.
- The pane closes after normal autonomous completion.
- A pending `ask_parent` question keeps the pane open and healthy.
- Long work does not become stalled only because it takes a long time.

### Interactive children

- `interactive: true` starts a persistent pane.
- The pane stays open after an agent turn ends.
- Tool permissions stay unchanged during takeover.
- Use `/subagent-done` when the work is complete.

Only one action permanently promotes an autonomous child to interactive:

- Submit an accepted, non-command prompt directly in the child terminal.

These actions do not promote it:

- Typing or editing without submission
- Pasting or navigation
- Running an extension command
- Receiving a parent continuation
- Receiving any extension-injected message

### `/subagent-done`

`/subagent-done` exists only inside children.

- During an active turn, it refuses to close and shows a warning.
- While idle, it writes a trusted completion marker and shuts down.
- It is not a model tool.
- It is never registered in the parent.

