local utils = require 'plugins.ui.dashboard.utils'

return {
  -- Spec Source
  'nvimdev/dashboard-nvim',
  name = 'dashboard',

  -- Spec Setup
  opts = {
    -- 'hyper', 'doom'
    theme = 'hyper',

    -- config used by theme
    config = utils.theme.hyper,

    -- 'letter', 'number'
    shortcut_type = 'number',

    -- for open file in hyper mru. it will change to the root of vcs
    change_to_vcs_root = true,

    -- hide these ui components on start
    hide = {
      statusline = true,
      tabline = true,
      winbar = true,
    },
  },

  -- Spec Lazy Loading
  event = 'VimEnter',
}
