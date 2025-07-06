local utils = require 'plugins.ui.trouble.utils'

return {
  -- Spec Source
  'folke/trouble.nvim',
  name = 'trouble',

  -- Spec Setup
  config = function()
    require 'plugins.ui.trouble.setup'
    require 'plugins.ui.trouble.autocmds'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<leader>d', utils.show_panel 'diag', desc = 'Trouble: Show Diagnostics' },
    { '<leader>D', '<cmd>Trouble diag close<CR>', desc = 'Trouble: Hide Diagnostics' },

    { '<leader>t', utils.show_panel 'todolist', desc = 'Trouble: Show Todo List' },
    { '<leader>T', '<cmd>Trouble todolist close<CR>', desc = 'Trouble: Hide Todo List' },
  },
}
