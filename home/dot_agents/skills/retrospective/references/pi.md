# Pi harness reference

Use this reference when the current harness is Pi. Pi sets `AI_AGENT=pi` and `PI_CODING_AGENT=true` for agent-run shell commands.

## Build a fixed transcript

Use `scripts/analyze-pi-session.mjs` from this skill directory. Create one private temporary directory outside the workspace, then run the analyzer once per Retrospective source:

```bash
umask 077
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/retrospective-pi.XXXXXX")
chmod 700 "$TEMP_DIR"
node scripts/analyze-pi-session.mjs --output "$TEMP_DIR/<source-number>.jsonl" "<session-identifier>"
```

Resolve relative script paths against the directory containing this skill's `SKILL.md`, not the workspace. The analyzer creates normalized JSONL files with mode `0600`. It extracts image payloads into a sibling assets directory with mode `0700` and image files with mode `0600`. Use the image paths in normalized message records to inspect visual evidence.

The analyzer accepts a full ID, a unique ID prefix, or a session JSONL path. It searches:

- `$PI_CODING_AGENT_SESSION_DIR`, when set
- `$PI_CODING_AGENT_DIR/sessions`, or `~/.pi/agent/sessions`
- the directory containing `$PI_SESSION_FILE`, when set

It fails when an ID is missing or ambiguous, when a completed line is malformed, or when the fixed cutoff ends inside an in-progress JSON record. It takes a fixed, read-only snapshot and never opens the source through Pi APIs that can migrate or repair it. The metadata line records the resolved session ID and path, snapshot time, byte cutoff, final active-branch entry, and whether the file grew during capture.

After resolution, compare the metadata `sessionId` with `$PI_SESSION_ID`. Also compare the canonical metadata `sourcePath` with the canonical `$PI_SESSION_FILE` when that variable is set. Either match means the selected source is the current session, including selection through a prefix or path. Explain that the fixed snapshot excludes later messages and that the report will be part of the session being reviewed. Ask for confirmation before analysis.

## Transcript semantics

A Pi session file is a JSONL tree. The final physical entry is Pi's active leaf when the file is reopened. The analyzer walks its parent chain to select only the active branch.

The normalized JSONL contains:

1. One `retrospective_session` metadata record.
2. Every raw `user` and `assistant` message on the active branch, both before and after compaction entries.
3. User and tool-result images extracted as private files, referenced by their normalized message records.
4. Tool calls, tool-result messages, and bash-execution messages so the Retrospective can retain only those needed as evidence.

The analyzer excludes assistant thinking, compaction summaries, branch summaries, abandoned branches, and extension state. A compaction count is metadata only; compaction never replaces raw messages in a Retrospective.

Each normalized message has a stable `position` for evidence citations. Inspect every user and assistant message. Inspect tool material enough to decide whether it proves a candidate, explains a wrong direction, shows repeated friction, or preserves a useful fact. Do not quote routine tool output in the report.

For large JSONL output, read bounded ranges until every numbered message is accounted for. Keep a candidate ledger keyed by source session ID and message position. Do not rely on Pi's compaction summary as a substitute for earlier ranges.

## Context files

Pi loads context files in layers:

- Global: `~/.pi/agent/AGENTS.md`
- Ancestors of the source session's `cwd`
- The source session's `cwd`

At each workspace directory, `AGENTS.override.md` takes priority. Otherwise Pi uses `AGENTS.md` or `CLAUDE.md`. Inspect the applicable source-managed files, not generated copies when repository instructions identify a source-of-truth path. A Context candidate can propose a new applicable context file when none exists.

## Skills

Pi discovers skills from global and trusted project locations, including `~/.agents/skills`, `~/.pi/agent/skills`, `.agents/skills`, and `.pi/skills`. A skill directory contains `SKILL.md` with frontmatter:

```markdown
---
name: lower-case-name
description: What the skill does and when to use it.
---
```

Set `disable-model-invocation: true` for a skill that only the user should invoke. Consult Pi's `docs/skills.md` or the Agent Skills specification before drafting details.

Inventory skill names and descriptions to prevent duplicate New skill proposals. Read a full existing skill only when the user named it for improvement or its description indicates a probable duplicate. Never propose an improvement to another existing skill.

## Prompt templates

Pi loads global templates from `~/.pi/agent/prompts/*.md` and project templates from `.pi/prompts/*.md`. The filename is the slash-command name. Template files use this format:

```markdown
---
description: Short autocomplete description
argument-hint: "<required> [optional]"
---

Prompt text using $1, $2, $ARGUMENTS, or defaults such as ${1:-default}.
```

Inventory template names and descriptions to prevent duplicate New prompt template proposals. Read a full existing template only when the user named it for improvement or its description indicates a probable duplicate. Never propose an improvement to another existing template.

Use the source session's `cwd` to determine workspace-local scope. Ask the user to choose global or workspace-local placement for every proposed new skill or prompt template.

Delete the exact temporary directory created for this run after the proposal report is complete. Never delete a path that was not created by this Retrospective run.
