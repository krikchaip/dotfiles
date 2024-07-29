local M = require 'diffview.actions'

M.close_diffview = function()
  local ok, _ = pcall(vim.cmd, 'tabnext# | tabclose#')
  if not ok then vim.cmd [[silent tabclose]] end
end

return M
