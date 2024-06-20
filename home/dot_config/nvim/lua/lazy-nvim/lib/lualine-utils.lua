local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

local M = {}

M.branch = { 'branch', on_click = function() require('telescope.builtin').git_branches() end }
M.filetype = { 'filetype', on_click = function() require('telescope.builtin').filetypes() end }
M.filename = { 'filename', on_click = function() custom_pickers.find_files() end }

return M
