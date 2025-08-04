# NvChad Configuration Overview

This document summarizes the key characteristics of the NvChad configuration located in this directory.

## Core Architecture

- **Base:** The configuration is built on **NvChad v2.5**.
- **Plugin Manager:** It uses **lazy.nvim** for all plugin management.
- **Main Entrypoint:** `init.lua` bootstraps `lazy.nvim` and loads all other plugins and configurations.

## Key Configuration Files

- `lua/chadrc.lua`: This is the primary user configuration file. It controls the theme (`embark`), UI components like the statusline, and the NvChad dashboard (`nvdash`).
- `lua/mappings.lua`: Contains a large and highly personalized set of keymaps, including Emacs-style navigation, extensive window/buffer management, and shortcuts for various plugins.
- `lua/options.lua`: Sets global Neovim options, such as disabling line wrap, setting scroll offsets, and configuring whitespace characters.
- `lua/autocmds.lua`: Defines custom autocommands for behaviors like highlighting yanked text, restoring cursor position, and managing buffer placement.
- `lua/utils.lua`: A crucial helper file that creates wrapper functions (e.g., `LSP.Hover`, `Telescope.Grep`, `Explorer.Open`) around plugin functionalities. These wrappers are then used in `mappings.lua`, creating a clean abstraction layer.

## Plugin & Customization Strategy

The configuration follows a clean pattern of separating plugin specifications from their configurations:

- **Plugin Lists:** `lua/plugins/init.lua` and `lua/plugins/mini.lua` define which plugins to load.
- **Plugin Setups:** The `lua/configs/` directory contains individual Lua files for configuring each plugin in detail. This is where most of the customization logic resides.

### Notable Plugins & Features

- **AI Assistant:** `codecompanion.nvim` is heavily integrated and configured to use the `gemini` adapter. It includes custom keymaps and extensions for history and summarization.
- **Search:** `telescope.nvim` is the central search tool, customized to use `fd` for file finding and `rg` for text searching. It includes custom functions like `SearchNode` for directory navigation.
- **File Explorer:** Both `nvim-tree.lua` and `mini.files` are configured. `mini.files` appears to be the primary choice, with advanced features like a gitignore filter and image previews.
- **Formatting & Linting:** `conform.nvim` handles formatting for a wide range of languages. `lint.nvim` is set up with linters like `eslint_d` and `pylint`, including specific workarounds for common issues.
- **LSP:** `nvim-lspconfig` is configured for numerous language servers. Default NvChad keymaps are disabled in favor of the custom mappings in `lua/mappings.lua`.
- **Folding:** `ufo.nvim` is used for code folding, configured to use Treesitter as its primary provider.
- **Session Management:** `possession.nvim` is set up to automatically save and load sessions.
