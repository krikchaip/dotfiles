---
name: conversation-manager
description: Search, read, move, or rename OpenCode conversation and session metadata
---

# Conversation Manager Skill

Specialized logic for managing OpenCode conversation/session stored in the local SQLite database.

## Goal

Enable efficient search and metadata management (move/rename) for OpenCode conversations/sessions.

## Instructions

1. **Identify Current Session**: If the user refers to "this conversation", "this", or "current session":
   - Use `current_session_id` or unique `title` if provided.
   - If not provided, ask the primary agent to supply it to ensure precision.

2. **Search Conversations**: Find session IDs using `sqlite3`. Search `session` table using `LIKE` on `title`. If multiple match, pick most relevant/latest.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "SELECT id, title, directory FROM session WHERE title LIKE '%<term>%';"
   ```

3. **Read & Analyze**: Extract conversation parts to a temporary file for analysis.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM part WHERE session_id = '<sid>' ORDER BY time_created ASC;" > /tmp/opencode-conversations/<title>.json
   ```

   - Synthesize raw JSON into a human-readable summary.
   - Focus on code snippets, file paths, and final resolutions.

4. **Move Session**: Update `project_id` and `directory`.
   - Find target project ID first: `SELECT id FROM project WHERE worktree = '<path>';`
   - Update session: `UPDATE session SET project_id = '<pid>', directory = '<path>' WHERE id = '<sid>';`

5. **Rename Session**: Update `title`.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db "UPDATE session SET title = '<new_title>' WHERE id = '<sid>';"
   ```

6. **Introspect Schema**: If table structure is unknown, get live schema.

   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db ".schema"
   ```

## Constraints

- **Validation**: Always run a `SELECT` query to verify IDs before performing an `UPDATE`.
- **Target Paths**: Ensure destination `directory` exists and corresponds to a known `project_id`.
- **Schema**: Use live introspection (`.schema`) to avoid outdated assumptions about table structure.
- **Minimal Output**: Return concise success confirmations or table-formatted search results.
