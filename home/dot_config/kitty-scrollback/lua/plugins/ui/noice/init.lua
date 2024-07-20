return {
  -- Spec Source
  'folke/noice.nvim',
  name = 'noice.nvim',

  -- Spec Setup
  config = function()
    require 'plugins.ui.noice.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<leader>M', '<cmd>Noice dismiss<CR>', desc = 'Notifications: Dismiss All' },
  },
}
