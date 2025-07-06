local utils = require 'plugins.ui.tabline.tabby.utils'

return {
  -- Spec Source
  'nanozuki/tabby.nvim',
  name = 'tabby',

  -- Spec Setup
  config = function()
    require 'plugins.ui.tabline.tabby.setup'
    require 'plugins.ui.tabline.tabby.autocmds'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<C-t>r', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },
    { '<C-t><C-r>', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },

    { '<C-t>p', utils.win_select, desc = 'Tab: Pick Window' },
    { '<C-t><C-p>', utils.win_select, desc = 'Tab: Pick Window' },
  },

  -- Spec Versioning
  commit = '9705aee',
}
