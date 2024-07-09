local M = {}

function M.pick_window()
  local picker = require 'window-picker'

  local winnr = picker.pick_window()
  if winnr then vim.api.nvim_set_current_win(winnr) end
end

return M
