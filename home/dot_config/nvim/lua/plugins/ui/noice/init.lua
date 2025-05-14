return {
  -- Spec Source
  'folke/noice.nvim',
  name = 'noice.nvim',

  -- Spec Setup
  config = function()
    require 'plugins.ui.noice.opts'
    require 'plugins.ui.noice.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<leader>nh', '<cmd>Noice history<CR>', desc = 'Notifications: Noice History' },
    { '<leader>nl', '<cmd>Noice last<CR>', desc = 'Notifications: Show Last Message' },
    { '<leader>ne', '<cmd>Noice errors<CR>', desc = 'Notifications: Show Errors' },

    { '<leader>N', '<cmd>Noice dismiss<CR>', desc = 'Notifications: Dismiss All' },
  },

  -- Spec Versioning
  -- tag = 'v4.0.0',
}
