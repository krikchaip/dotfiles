---
description: Sync a forked extension with updated upstream primary branch
argument-hint: "<extension-repository> [personal-branch] [primary-branch]"
---

Help me `/skill:resolving-merge-conflicts` for `$1`.

Context: I recently synced `${3:-main}` with the upstream primary branch and I'm about to rebase `${2:-personal}` onto `${3:-main}`. I want to keep the fork current with upstream features without overriding my personal customizations.

For each conflict:

- Find the intent of both changes from the code and commit history.
- Explain each conflicting hunk in ASD-STE100 Simplified Technical English.
- Preserve both intents when they are compatible.
- Apply personal-only behavior directly when it does not conflict with upstream behavior.
- Use `/skill:grilling` only for a genuine, incompatible feature behavior conflict between upstream and personal changes. Do not ask for routine conflicts, personal-only behavior, or facts that you can verify in the codebase.
- When a decision is necessary, ask one concise question with a recommendation. Wait for my answer before you resolve that behavior conflict.
- Do not invent behavior. Do not abort the rebase.

Run the project checks after resolving conflicts. Continue the rebase until it finishes.
