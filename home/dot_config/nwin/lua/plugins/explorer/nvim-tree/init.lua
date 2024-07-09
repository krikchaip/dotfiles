return {
  -- Spec Source
  'nvim-tree/nvim-tree.lua',
  name = 'nvim-tree',

  -- Spec Loading
  dependencies = { 'lsp-file-operations' },

  -- Spec Setup
  config = function()
    require 'plugins.explorer.nvim-tree.setup'
  end,

  -- Spec Lazy Loading
  keys = require('plugins.explorer.nvim-tree.keymaps').lazy(),
}
