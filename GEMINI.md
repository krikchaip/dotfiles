# GEMINI.md

## Directory Overview

This directory is a `chezmoi` dotfile manager for the user `krikchaip`. It contains personal configurations for various tools, including `.zshrc`, `.gitconfig`, and many others. The setup is automated with `chezmoi` and includes scripts for installing packages and setting up the environment.

## Key Files

*   `README.md`: Provides an overview of the dotfiles and basic `chezmoi` commands.
*   `home/.chezmoiignore`: Specifies files and patterns to be ignored by `chezmoi`.
*   `home/.chezmoidata/config.yaml`: Contains configuration data for `chezmoi` templates, such as the default shell.
*   `home/.chezmoitemplates/`: This directory holds Go `text/template` files used to dynamically generate configuration files.
*   `home/.chezmoiscripts/`: Contains scripts that are run by `chezmoi` during `chezmoi apply`.
    *   `run_onchange_install-packages.sh.tmpl`: A key script that installs Homebrew, Brewfile packages, Neovim plugins, and various other packages using `mise`, `pipx`, and `go`. It also manages `yabai` and `skhd` services.
*   `home/dot_config/chezmoi/chezmoi.toml.tmpl`: The `chezmoi` configuration file itself, which is also templated. It defines commands for `cd`, `diff`, and `edit`, and a `textconv` for `plist` files.

## Usage

This directory is managed by the `chezmoi` tool. The primary commands for interacting with this setup are:

*   **Installation:**
    ```sh
    sh -c "$(curl -fsLS get.chezmoi.io)" -- -b $HOME/.local/bin init --apply krikchaip
    ```
*   **Adding a new file:**
    ```sh
    chezmoi add ~/path/to/new/stuff
    ```
*   **Editing configurations:**
    ```sh
    chezmoi edit
    ```
*   **Applying changes:**
    ```sh
    chezmoi apply -v
    ```
*   **Updating from the remote repository:**
    ```sh
    chezmoi update -v
    ```

The `run_onchange_install-packages.sh.tmpl` script automates the installation and setup of a significant portion of the user's development environment. This includes system packages via Homebrew, as well as language-specific packages for Python, Node.js, and Go.
