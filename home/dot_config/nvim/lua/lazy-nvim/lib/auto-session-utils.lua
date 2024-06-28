local M = {}

-- NOTE: `auto_save_enabled` does not work until `auto_save > in_pager_mode` is fixed.
-- ref: https://github.com/rmagatti/auto-session/blob/main/lua/auto-session/init.lua#L200
--
--     This is simply because of the `opened_with_args` variable,
--     `vim.fn.argv()` returns result from last command's argv()
--     instead of what have started nvim at the beginning.
function M.setup_autosave_session()
  local auto_session = require 'auto-session'

  local group = vim.api.nvim_create_augroup('auto-session-manual', { clear = true })

  vim.api.nvim_create_autocmd('VimLeavePre', {
    desc = 'Auto save the current session before leaving Neovim',
    group = group,
    pattern = '*',
    callback = function()
      local session_dir = vim.loop.cwd()
      if not vim.g.in_pager_mode then auto_session.SaveSession(session_dir, true) end
    end,
  })
end

function M.load_session(session_dir)
  local auto_session = require 'auto-session'
  local api = require 'nvim-tree.api'

  local bd = smart_delete_buffer()

  local ok = auto_session.RestoreSession(session_dir)
  M.setup_autosave_session()

  if not ok then
    bd()
    api.tree.toggle { focus = false }
  end
end

return M
