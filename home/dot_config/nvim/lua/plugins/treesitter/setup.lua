require('nvim-treesitter.configs').setup {
  -- Autoinstall languages that are not installed
  auto_install = true,

  ensure_installed = {
    'git_config',
    'git_rebase',
    'gitattributes',
    'gitcommit',
    'gitignore',

    'bash',
    'nu',
    'tmux',

    'lua',
    'luadoc',

    'vim',
    'vimdoc',

    'regex',

    'html',
    'css',
    'javascript',
    'typescript',
    'tsx',

    'json',
    'jsonc',
    'yaml',

    'markdown',
    'markdown_inline',

    'elixir',

    'ruby',
  },

  -- Treesitter Features
  highlight = require 'plugins.treesitter.features.highlight',
  indent = require 'plugins.treesitter.features.indent',
  incremental_selection = require 'plugins.treesitter.features.incremental-selection',
  textobjects = require 'plugins.treesitter.features.textobjects',
}
