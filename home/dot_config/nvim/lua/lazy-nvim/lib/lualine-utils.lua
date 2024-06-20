local M = {}

M.filetype = {
  'filetype',
  on_click = function() require('telescope.builtin').filetypes() end,
}

return M
