local auto_session_utils = require 'lazy-nvim.lib.auto-session-utils'

local M = { theme = {} }

M.theme.hyper = {
  -- header = {},

  week_header = {
    enable = true,

    -- concat string after time string line
    -- concat = '',

    -- table append after time string line
    -- append = {},
  },

  -- disable movement keymaps
  disable_move = true,

  shortcut = {
    { desc = '  Restore Last Session ', group = '@boolean', key = 'r', action = auto_session_utils.load_session },
    { desc = '  New File ', group = '@character', key = 'n', action = 'bd' },
  },

  -- show how many plugins neovim loaded
  packages = { enable = true },

  project = { limit = 8, action = auto_session_utils.load_session },

  mru = { limit = 8 },

  -- footer = {},
}

return M
