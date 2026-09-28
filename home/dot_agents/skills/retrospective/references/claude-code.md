# Claude Code harness reference

Use this reference when the current harness is Claude Code. Claude Code sets `CLAUDECODE=1` for agent-run shell commands.

## Build a fixed transcript

Use `scripts/analyze-claude-code-session.mjs` from this skill directory. Create one private temporary directory outside the workspace, then run the analyzer once per Retrospective source:

```bash
umask 077
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/retrospective-claude-code.XXXXXX")
chmod 700 "$TEMP_DIR"
node scripts/analyze-claude-code-session.mjs --output "$TEMP_DIR/<source-number>.jsonl" "<session-identifier>"
```

Resolve relative script paths against the skill's base directory, which Claude Code prints when it loads this skill, not the workspace. The analyzer creates normalized JSONL files with mode `0600`. It extracts image payloads into a sibling assets directory with mode `0700` and image files with mode `0600`. Use the image paths in normalized message records to inspect visual evidence.

The analyzer accepts a full session ID, a unique ID prefix, a transcript JSONL path, or an exact session title (the `/rename` title, else the generated title). It searches `$CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects`, for `<encoded-cwd>/<session-id>.jsonl`. Claude Code deletes transcripts older than [`cleanupPeriodDays`](https://code.claude.com/docs/en/settings-reference#cleanupperioddays), so a missing old session was probably swept.

It fails when an identifier is missing or ambiguous, when a completed line is malformed, when the fixed cutoff ends inside an in-progress JSON record, or when the active branch has a broken parent link. It takes a fixed, read-only snapshot. The metadata line records the resolved session ID and path, snapshot time, byte cutoff, leaf entry, and whether the file grew during capture.

Metadata `isCurrentSession` compares the session ID with `$CLAUDE_CODE_SESSION_ID`. When it is `true`, explain that the fixed snapshot excludes later messages and that the report will be part of the session being reviewed. Ask for confirmation before analysis. When it is `null`, the variable was unset: treat the newest transcript in the current workspace's project directory as the probable current session and ask.

## Transcript semantics

A Claude Code transcript is an append-only JSONL tree of entries linked by `uuid` and `parentUuid`. The analyzer picks the leaf that `claude --resume` would continue: the newest user or assistant entry, unless a later `last-prompt` record moved the leaf to another branch. It walks the parent chain from that leaf and crosses each compaction boundary through `logicalParentUuid`, so raw messages from before every compaction stay in the transcript.

Two write patterns fork the chain on the active branch, and the analyzer rejoins both:

- One API response is written as one entry per content block. The analyzer merges them into one assistant record and lists every source entry in `entryIds`.
- A parallel tool result points at the entry that issued its call, not at the previous result. The analyzer keeps every result whose call is on the active branch.

The normalized JSONL contains one `retrospective_session` metadata record, then message records in transcript order. Each record has a stable `position` for evidence citations and a `role`:

| Role         | Content                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`       | A human prompt, including prompts queued while the agent worked (`source: "queued_command:prompt"`) and interruption markers.                                                                                                                        |
| `assistant`  | Visible text and `toolCalls`; server-tool results sit in `serverToolResults`.                                                                                                                                                                        |
| `toolResult` | One tool result with `toolCallId`, `toolName`, and `isError`.                                                                                                                                                                                        |
| `command`    | A slash command the user ran, or its local output.                                                                                                                                                                                                   |
| `harness`    | Injected context the user did not type. `source` names it: `meta` (a loaded skill body or caveat), `origin:<kind>` (a subagent hand-back or task notification), `queued_command:<mode>`, or `edited_text_file` (the user edited a file mid-session). |

Treat `user` and `command` records as the user's messages and `assistant` records as the agent's messages. Inspect `toolResult` and `harness` records only as evidence; quote no routine tool output in the report.

The analyzer excludes assistant thinking, compaction summaries, abandoned branches, subagent sidechains, and other harness attachments such as hook output and reminders. These metadata fields cover what it leaves out:

- `abandonedMessageCount`: messages on rewound or edited branches. Read the raw source only when a rewind itself is evidence.
- `unbridgedCompaction` and `forkedFromSessionIds`: a forked session copies only the history after the source's last compaction. Earlier messages live in the source session; ask whether to add it as a Retrospective source.
- `subagentTranscripts`: raw transcripts of delegated agents. Their hand-back reports are already `harness` records; read a subagent transcript only when its internal work is evidence.
- `persistedToolResults`: oversized tool outputs stored outside the transcript. The matching tool result names its file.

For large JSONL output, read bounded ranges until every numbered message is accounted for. Keep a candidate ledger keyed by source session ID and message position. Do not rely on a compaction summary as a substitute for earlier ranges.

## Context files

Metadata `contextFiles` lists the context files that actually loaded in the session, with their scope. Start there, then follow each file's `@path` imports, up to four hops. Claude Code [loads](https://code.claude.com/docs/en/memory):

- Managed policy: `/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS, `/etc/claude-code/CLAUDE.md` on Linux.
- User: `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md`.
- Every directory from the filesystem root down to the source session's `cwd`: `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md`, plus `.claude/rules/**/*.md` for the project. A rule with `paths` frontmatter loads only when Claude works with matching files.
- Subdirectory `CLAUDE.md` files, loaded on demand when Claude reads a file in that subtree.

By default Claude Code reads `AGENTS.md` and `.claude/AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists at the `cwd` or above it. It never reads `AGENTS.override.md` or `AGENTS.local.md`. A `CLAUDE.md` that only imports `AGENTS.md` makes `AGENTS.md` the real target. Propose each change in the file that holds the rule, and prefer the source-managed file when repository instructions identify one. A Context candidate can propose a new applicable context file when none exists.

Claude also keeps auto memory in `~/.claude/projects/<project>/memory/MEMORY.md`. Read it to drop candidates it already states. It is Claude-managed, so never target it with a proposal.

## Skills

Claude Code discovers [skills](https://code.claude.com/docs/en/skills) from `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, nested `<subdir>/.claude/skills/`, managed settings, and enabled plugins. These directories are often symlinks; resolve them and edit the source-managed files. A skill directory contains `SKILL.md` with frontmatter:

```markdown
---
name: lower-case-name
description: What the skill does and when to use it.
---
```

Set `disable-model-invocation: true` for a skill that only the user should invoke. Consult the skills documentation for other frontmatter fields before drafting details.

Inventory skill names and descriptions to prevent duplicate New skill proposals. Read a full existing skill only when the user named it for improvement or its description indicates a probable duplicate. Never propose an improvement to another existing skill.

## Prompt templates

Claude Code's prompt templates are custom commands, now merged into skills. `~/.claude/commands/<name>.md` and `.claude/commands/<name>.md` create `/<name>`, and a skill of the same name wins. A command file uses skill frontmatter except `name` and `paths`:

```markdown
---
description: Short autocomplete description
argument-hint: "<required> [optional]"
---

Prompt text using $ARGUMENTS, $0, $1, or $ARGUMENTS[0].
```

Positional arguments are zero-based: `$0` is the first argument. Draft a new prompt template as a command file. Draft it as a skill instead when it needs bundled files or invocation control.

Inventory command names and descriptions to prevent duplicate New prompt template proposals. Read a full existing command only when the user named it for improvement or its description indicates a probable duplicate. Never propose an improvement to another existing command.

Use the source session's `cwd` to determine workspace-local scope. Ask the user to choose global or workspace-local placement for every proposed new skill or prompt template.

Delete the exact temporary directory created for this run after the proposal report is complete. Never delete a path that was not created by this Retrospective run.
