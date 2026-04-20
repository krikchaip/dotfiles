---
description: Durable notes for chezmoi repo AI prompt architecture and key config gotchas
label: ai-prompts-centralization
limit: 5000
read_only: false
---

- AI rule policies are centralized in `home/dot_agents/RULES.md.tmpl`.
- These are symlinked/deployed to multiple AI agent runtimes (OpenCode, Gemini, Windsurf) during `chezmoi apply`.
- Any global instruction changes should be made to this template first.
