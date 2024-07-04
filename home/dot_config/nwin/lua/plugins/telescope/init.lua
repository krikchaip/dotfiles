-- Fuzzy Finder (files, lsp, etc)
-- ref: https://github.com/nvim-telescope/telescope.nvim
return {
  {
    -- Spec Source
    'nvim-telescope/telescope.nvim',
    name = 'telescope',

    -- Spec Loading
    dependencies = { 'plenary', 'web-devicons', 'treesitter' },

    -- Spec Setup
    config = function()
      require 'plugins.telescope.setup'
      require 'plugins.telescope.autocmds'
    end,

    -- Spec Lazy Loading
    cmd = { 'Telescope' },
    keys = require('plugins.telescope.keymaps').lazy(),
  },

  unpack(require 'plugins.telescope.extensions'),
}
