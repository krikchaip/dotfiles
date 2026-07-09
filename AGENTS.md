Dotfiles repo:
- This is a `chezmoi`-managed dotfiles repository
- Source files are located in `~/.local/share/chezmoi/home/`
- DO NOT edit files in `~` directly; always edit the source templates/files in the repo and run `chezmoi apply` to copy files to user's home directory

Package installation/management:
- Binaries and tools are managed via `home/dot_Brewfile` using Homebrew
- To install new packages, add them to this file and let `chezmoi apply` handle the installation
- To uninstall packages, remove them from `home/dot_Brewfile`, run `chezmoi apply`, and manually run `brew uninstall <package>` and `brew autoremove` to clean up dependencies

Agent skills:
- Issue tracker: Local markdown specs and tickets under `.scratch/<feature-slug>/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.
- Triage labels: Canonical label roles map to same string values in local markdown ticket `Status:` fields. See `docs/agents/triage-labels.md`.
- Domain docs: Multi-context layout with `CONTEXT-MAP.md` pointing to per-context files. See `docs/agents/domain.md`.
