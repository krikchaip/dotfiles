local M = require 'diffview.actions'

M.close_diffview = function()
  vim.cmd [[silent! tabnext# | silent! tabclose#]]
end

return M
