---
name: commit-message
description: Generate a terse Conventional Commit message from staged changes only. Output only paste-ready commit text.
disable-model-invocation: true
---

Write commit messages terse and exact. Conventional Commits format. No fluff. Why over what. Output raw plain text only without code fences or quotes.

## Input

- Treat the Git index as the complete, reviewed commit scope.
- Analyze `git diff --cached` only. Read staged file content with `git show :<path>` when needed.
- Exclude working-tree changes and untracked files, including unstaged changes in partly staged files.
- Use commit history only to match the project's message conventions.
- If the index is empty, output only `No staged changes.`

## Rules

**Subject line:**
- `<type>(<scope>): <imperative summary>` — `<scope>` optional
- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding"
- ≤50 chars when possible, hard cap 72
- No trailing period
- Match project convention for capitalization after the colon

**Description/body (only if needed):**
- Skip entirely when subject is self-explanatory
- Add body only for: non-obvious *why*, breaking changes, migration notes, linked issues
- Wrap at 72 chars
- Bullets `-` not `*`
- Reference issues/PRs at end: `Closes #42`, `Refs #17`

**What NEVER goes in:**
- "This commit does X", "I", "we", "now", "currently" — the diff says what
- "As requested by..." — use Co-authored-by trailer
- "Generated with Claude Code" or any AI attribution — unless the user's own rule requires an `Assisted-by`/AI-attribution trailer, then add it as a trailer
- Emoji (unless project convention requires)
- Markdown code blocks (```), backticks, or surrounding quotes
- Restating the file name when scope already says it

## Examples

Diff: new endpoint for user profile with body explaining the why
- ❌ feat: add a new endpoint to get user profile information from the database
- ✅
  feat(api): add GET /users/:id/profile

  Mobile client needs profile data without the full user payload
  to reduce LTE bandwidth on cold-launch screens.

  Closes #128

Diff: breaking API change
- ✅
  feat(api)!: rename /v1/orders to /v1/checkout

  BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
  before 2026-06-01. Old route returns 410 after that date.

## Auto-Clarity

Always include body for: breaking changes, security fixes, data migrations, anything reverting a prior commit. Never compress these into subject-only — future debuggers need the context.

## Output Contract

- Return the subject and optional body or trailers as raw plain text.
- Preserve commit-ready spacing: one blank line between the subject, body, and trailers.
- Put no Markdown fence, prose, label, analysis, alternative, or command around the commit text.
- Do not run `git commit`, stage files, or amend a commit.
