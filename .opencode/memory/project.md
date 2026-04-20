---
description: "Durable, high-signal information about this codebase: commands, architecture notes, conventions, and gotchas."
label: project
limit: 5000
read_only: false
---

- This is a `chezmoi` managed dotfiles repository.
- Source files are located in `~/.local/share/chezmoi/home/`.
- Deployment/Target: `chezmoi apply` symlinks or copies files to the user's home directory (`~`).
- DO NOT edit files in `~` directly; always edit the source templates/files in the repo.
