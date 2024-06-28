local M = {}

function M.load_session(session_dir)
  local auto_session = require 'auto-session'
  local api = require 'nvim-tree.api'

  local bd = smart_delete_buffer()

  local ok = auto_session.RestoreSession(session_dir)
  if ok then return end

  bd()
  api.tree.toggle { focus = false }
end

return M
