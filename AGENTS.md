Dotfiles repo:
- This is a `chezmoi`-managed dotfiles repository
- Source files are located in `~/.local/share/chezmoi/home/`
- DO NOT edit files in `~` directly; always edit the source templates/files in the repo and run `chezmoi apply` to copy files to user's home directory
- When moving or renaming a managed source file, remove its old target file after applying the new one. Chezmoi does not track moves or renames, so it leaves stale target files behind.

Package installation/management:
- Binaries and tools are managed via `home/dot_Brewfile` using Homebrew
- To install new packages, add them to this file and let `chezmoi apply` handle the installation
- To uninstall packages, remove them from `home/dot_Brewfile`, run `chezmoi apply`, and manually run `brew uninstall <package>` and `brew autoremove` to clean up dependencies

Pi customization tests:
- Store E2E tests for files in `home/dot_pi/agent/extensions/` under its `test/` directory. Keep package tests inside each package.
- Build coverage from current user behavior and relevant bug-fix history. Include normal flows and user-facing edge cases.
- If coverage work reveals a defect, add a deterministic known-red test and show the evidence. Get separate approval before changing production source.
- Use focused or bounded-parallel runs for fast feedback. Finish with a clean serial release gate and remove temporary test state.

Agent skills:
- Issue tracker: Local markdown specs and tickets under `.scratch/<feature-slug>/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.
- Triage labels: Canonical label roles map to same string values in local markdown ticket `Status:` fields. See `docs/agents/triage-labels.md`.
- Domain docs: Multi-context layout with `CONTEXT-MAP.md` pointing to per-context files. See `docs/agents/domain.md`.
