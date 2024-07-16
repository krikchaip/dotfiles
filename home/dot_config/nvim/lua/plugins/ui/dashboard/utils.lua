local M = {}

function M.load_session(session_dir)
  local auto_session = require 'auto-session'
  local api = require 'nvim-tree.api'

  local bd = smart_delete_buffer()
  local ok = auto_session.RestoreSession(session_dir)

  if not ok then
    bd()
    api.tree.toggle { focus = false }
  end
end

M.theme = {
  hyper = {
    -- header = {},

    week_header = {
      enable = true,

      -- concat string after time string line
      concat = tostring(vim.loop.cwd()),

      -- table append after time string line
      -- append = {},
    },

    -- disable movement keymaps
    disable_move = true,

    shortcut = {
      { desc = '  Restore Last Session ', group = '@boolean', key = 'r', action = M.load_session },
      { desc = '  New File ', group = '@character', key = 'n', action = 'bd' },
    },

    -- show how many plugins neovim loaded
    packages = { enable = true },

    project = { limit = 8, action = M.load_session },

    mru = { limit = 8 },

    -- footer = {},
  },
}

return M
