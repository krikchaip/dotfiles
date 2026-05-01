---
name: conversation-manager
description: Search, read, move, or rename OpenCode conversation and session metadata
---

# Conversation Manager Skill

Specialized logic for managing OpenCode conversation/session stored in the local SQLite database.

## Goal

Enable efficient search and metadata management (move/rename) for OpenCode conversations/sessions.

## Session Identity Terms

- `root session`: the top-level ancestor in the `session.parent_id` chain (`parent_id IS NULL`).
- `child session`: any subagent session with a non-null `parent_id`.

When this skill runs inside a nested subagent, your own immediate session ID is a child session, not the top-level user conversation. Use it to walk the lineage.

For move/rename requests, always mutate the root session only. If the caller points at a child session or a title that resolves to a child, walk the lineage and update the root ancestor instead.

## Instructions

1. **Resolve "This Conversation"**:
   - If the user refers to "this conversation", "this", or "current session", you need the root user conversation, not your own subagent session.
   - Execute this single query to directly find the root of the active conversation in your current directory:
     ```bash
     sqlite3 ~/.local/share/opencode/opencode.db "
     SELECT p.id, p.title, p.directory
     FROM session s
     JOIN session p ON s.parent_id = p.id
     WHERE p.parent_id IS NULL AND s.directory = '<current_directory>'
     ORDER BY s.time_updated DESC LIMIT 1;
     "
     ```
   - Use the returned `p.id` as the root session for mutations. You do not need the CTE lineage query.
   - Include the resolved root session ID in your final output/response. This allows the caller to use the explicit ID for subsequent operations instead of resolving it again.

2. **Resolve Explicit ID or Title**:
   - If the user provides an explicit `session_id` or title, locate the candidate ID first.
   - Once you have the candidate ID, walk its lineage to find the root session:
     ```bash
     sqlite3 ~/.local/share/opencode/opencode.db "
     WITH RECURSIVE lineage(id, parent_id, title, directory, depth) AS (
       SELECT id, parent_id, title, directory, 0
       FROM session WHERE id = '<candidate_session_id>'
       UNION ALL
       SELECT s.id, s.parent_id, s.title, s.directory, l.depth + 1
       FROM session s JOIN lineage l ON s.id = l.parent_id
     )
     SELECT id, title, directory FROM lineage WHERE parent_id IS NULL;
     "
     ```
   - Do not use title fallback as the final identifier without resolving lineage first.

3. **Search Conversations**: Find session IDs using `sqlite3`. Search `session` table using `LIKE` on `title` for discovery.
   - If multiple matches exist, prioritize the most recent session using `time_updated`.
   - For move/rename, if titles are ambiguous, list candidates with their last update time and ask the user to confirm.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "
   SELECT id, title, datetime(time_updated/1000, 'unixepoch') as last_updated
   FROM session
   WHERE title LIKE '%<term>%'
   ORDER BY time_updated DESC;
   "
   ```

4. **Read & Analyze**: Extract conversation parts to a temporary file for analysis.
   - If an explicit `session_id` is provided, verify it exists before reading. If not found, return an error.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM part WHERE session_id = '<sid>' ORDER BY time_created ASC;" > /tmp/opencode-conversations/<title>.json
   ```

   - Synthesize raw JSON into a human-readable summary.
   - Focus on code snippets, file paths, and final resolutions.

5. **Move Session**: Update `project_id` and `directory` on the resolved root session.
   - Find target project ID: `SELECT id FROM project WHERE worktree = '<path>';`
   - **Validation**: If the directory exists but no matching `project_id` is found, block and warn the user. Do not create new project entries automatically.
   - **Target Directory**: Default the session's `directory` to the project's `worktree` root.
   - Update session: `UPDATE session SET project_id = '<pid>', directory = '<path>' WHERE id = '<sid>';`

6. **Rename Session**: Update `title` on the resolved root session. Proceed silently if the target is already a root session, but note it in your internal resolution report.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "UPDATE session SET title = '<new_title>' WHERE id = '<sid>';"
   ```

7. **Introspect Schema**: If a query fails with a schema-related error (e.g., "no such column"), run `.schema` to diagnose. Do not run it proactively.

## Constraints

- **Validation**: Always run a `SELECT` query to verify IDs before performing an `UPDATE`.
- **Mutation Scope**: Move/rename always target the root conversation session, never a child session.
- **Identifier Safety**: For mutating actions, never auto-pick "most relevant/latest" from title search and update immediately.
- **Target Paths**: Ensure destination `directory` exists and corresponds to a known `project_id`.
- **Schema**: Use live introspection (`.schema`) to avoid outdated assumptions about table structure.
- **Minimal Output**: Return concise success confirmations or table-formatted search results. Always include the resolved session ID in your output.
