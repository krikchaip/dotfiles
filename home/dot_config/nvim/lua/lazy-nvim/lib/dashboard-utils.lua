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
  disable_move = false,

  shortcut = {},

  -- show how many plugins neovim loaded
  packages = { enable = true },

  project = {
    limit = 5,
    action = function(path)
      local auto_session = require 'auto-session'
      local api = require 'nvim-tree.api'

      local bd = smart_delete_buffer()
      local session_dir = path

      local ok = auto_session.RestoreSession(session_dir)
      if ok then return end

      bd()
      api.tree.toggle { focus = false }
    end,
  },

  mru = { limit = 10 },

  -- footer = {},
}

return M
