return {
  -- Spec Source
  'nvim-tree/nvim-tree.lua',
  name = 'nvim-tree',

  -- Spec Loading
  dependencies = { 'lsp-file-operations', 'nvim-tree-preview' },

  -- Spec Setup
  config = function()
    require 'plugins.explorer.nvim-tree.setup'
    require('plugins.explorer.nvim-tree.keymaps').amend()
  end,

  -- Spec Lazy Loading
  keys = require('plugins.explorer.nvim-tree.keymaps').lazy(),

  -- Spec Versioning
  version = '*',
}
