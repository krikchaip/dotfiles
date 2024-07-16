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
  cmd = 'Trouble',
  keys = {
    { '<leader>d', utils.show_panel 'diag', desc = 'Trouble: Show Diagnostics' },
    { '<leader>D', '<cmd>Trouble diag close<CR>', desc = 'Trouble: Hide Diagnostics' },

    { '<M-q>', utils.show_panel 'qf', desc = 'Trouble: Show Quickfix List' },
    { '<M-S-q>', '<cmd>Trouble qf close<CR>', desc = 'Trouble: Hide Quickfix List' },

    { '<M-w>', utils.show_panel 'll', desc = 'Trouble: Show Location List' },
    { '<M-S-w>', '<cmd>Trouble ll close<CR>', desc = 'Trouble: Hide Location List' },

    { '<leader>t', utils.show_panel 'todolist', desc = 'Trouble: Show Todo List' },
    { '<leader>T', '<cmd>Trouble todolist close<CR>', desc = 'Trouble: Hide Todo List' },
  },
}
