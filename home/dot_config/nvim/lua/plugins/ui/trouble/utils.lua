---@diagnostic disable: missing-parameter

local M = {}

M.preview_window_opts = {
  -- trouble.Window.split
  type = 'split',
  relative = 'win',
  position = 'right',
  size = 0.4,

  -- trouble.Window.base
  wo = {
    number = true,
    foldenable = false,
    statuscolumn = '',
  },
}

function M.show_panel(name)
  return function()
    local trouble = require 'trouble'

    if not trouble.is_open(name) then return trouble.open(name) end
    return trouble.focus(name)
  end
end

M.handle_quickfix_open = (function()
  local show_quickfix_panel = M.show_panel 'qf'
  return function()
    vim.cmd [[cclose]]
    show_quickfix_panel()
  end
end)()

return M
