-- Highlight, edit, and code navigation
-- ref: https://github.com/nvim-treesitter/nvim-treesitter
return {
  {
    -- Spec Source
    'nvim-treesitter/nvim-treesitter',
    name = 'treesitter',

    -- Spec Setup
    config = function()
      require 'plugins.treesitter.setup'
    end,
    build = ':TSUpdate',

    -- Spec Lazy Loading
    event = 'User FilePost',
  },

  unpack(require 'plugins.treesitter.extensions'),
}
