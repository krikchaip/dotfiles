Dotfiles repo:
- This is a `chezmoi`-managed dotfiles repository
- Source files are located in `~/.local/share/chezmoi/home/`
- DO NOT edit files in `~` directly; always edit the source templates/files in the repo and run `chezmoi apply` to copy files to user's home directory

Package installation/management:
- Binaries and tools are managed via `home/dot_Brewfile` using Homebrew
- To install new packages, add them to this file and let `chezmoi apply` handle the installation
- To uninstall packages, remove them from `home/dot_Brewfile`, run `chezmoi apply`, and manually run `brew uninstall <package>` and `brew autoremove` to clean up dependencies
