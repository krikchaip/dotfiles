return {
  -- Spec Source
  'nvim-lualine/lualine.nvim',
  name = 'lualine',

  -- Spec Setup
  config = function()
    require 'plugins.ui.lualine.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
