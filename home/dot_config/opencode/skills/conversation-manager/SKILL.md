---
name: conversation-manager
description: Search, read, move, or rename OpenCode conversation and session metadata
---

# Conversation Manager Skill

Specialized logic for managing OpenCode conversation/session stored in the local SQLite database.

## Goal

Enable efficient search and metadata management (move/rename) for OpenCode conversations/sessions.

## Session Identity Terms

- `current_session_id`: the session id of the currently running agent context.
- `root session`: the top-level ancestor in the `session.parent_id` chain (`parent_id IS NULL`).
- `child session`: any subagent session with a non-null `parent_id`.

When this skill runs inside a nested subagent, `current_session_id` usually identifies the child subagent session, not the top-level user conversation.

For move/rename requests, always mutate the root session only. If the caller points at a child session or a title that resolves to a child, walk the lineage and update the root ancestor instead.

## Instructions

1. **Resolve Requested Conversation**:
   - If the user refers to "this conversation", "this", or "current session", do not assume `current_session_id` is the top-level conversation.
   - First resolve the `parent_id` lineage and identify the root session.
   - If an explicit session id is provided for a move/rename, still verify whether it is a child and promote the target to its root ancestor before mutating.
   - Do not use title fallback as the final identifier for move/rename.

2. **Resolve Lineage from Current Session**: When `current_session_id` is available, walk upward until the root session is found.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "
   WITH RECURSIVE lineage(id, parent_id, title, directory, depth) AS (
     SELECT id, parent_id, title, directory, 0
     FROM session
     WHERE id = '<current_session_id>'
     UNION ALL
     SELECT s.id, s.parent_id, s.title, s.directory, l.depth + 1
     FROM session s
     JOIN lineage l ON s.id = l.parent_id
   )
   SELECT id, parent_id, title, directory, depth
   FROM lineage
   ORDER BY depth;
   "
   ```

   - Use the row with `parent_id IS NULL` as the root conversation for move/rename.

3. **Search Conversations**: Find session IDs using `sqlite3`. Search `session` table using `LIKE` on `title` for discovery.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "SELECT id, title, directory FROM session WHERE title LIKE '%<term>%';"
   ```

   - Title search is allowed for search/read.
   - For move/rename, title search may narrow candidates, but you must resolve the chosen candidate to its root session before any `UPDATE`.

4. **Read & Analyze**: Extract conversation parts to a temporary file for analysis.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM part WHERE session_id = '<sid>' ORDER BY time_created ASC;" > /tmp/opencode-conversations/<title>.json
   ```

   - Synthesize raw JSON into a human-readable summary.
   - Focus on code snippets, file paths, and final resolutions.

5. **Move Session**: Update `project_id` and `directory` on the resolved root session.
   - Find target project ID first: `SELECT id FROM project WHERE worktree = '<path>';`
   - Update session: `UPDATE session SET project_id = '<pid>', directory = '<path>' WHERE id = '<sid>';`

6. **Rename Session**: Update `title` on the resolved root session.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "UPDATE session SET title = '<new_title>' WHERE id = '<sid>';"
   ```

7. **Introspect Schema**: If table structure is unknown, get live schema.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db ".schema"
   ```

## Constraints

- **Validation**: Always run a `SELECT` query to verify IDs before performing an `UPDATE`.
- **Mutation Scope**: Move/rename always target the root conversation session, never a child session.
- **Identifier Safety**: For mutating actions, never auto-pick "most relevant/latest" from title search and update immediately.
- **Target Paths**: Ensure destination `directory` exists and corresponds to a known `project_id`.
- **Schema**: Use live introspection (`.schema`) to avoid outdated assumptions about table structure.
- **Minimal Output**: Return concise success confirmations or table-formatted search results.
