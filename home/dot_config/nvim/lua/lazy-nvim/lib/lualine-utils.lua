---@diagnostic disable: missing-parameter, param-type-mismatch

local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

local M = {}

M.branch = {
  'branch',
  on_click = function() require('telescope.builtin').git_branches() end,
}

M.diagnostics = {
  'diagnostics',

  sources = {
    'nvim_diagnostic',
    -- 'nvim_workspace_diagnostic',
    'nvim_lsp',
  },

  update_in_insert = false, -- Update diagnostics in insert mode.
  always_visible = false, -- Show diagnostics even if there are none.

  on_click = function() require('trouble').focus { mode = 'diag', filter = { buf = 0 } } end,
}

M.filename = {
  'filename',

  -- 0: Just the filename
  -- 1: Relative path
  -- 2: Absolute path
  -- 3: Absolute path, with tilde as the home directory
  -- 4: Filename and parent dir, with tilde as the home directory
  path = 4,

  symbols = {
    modified = '',
    readonly = '',
    unnamed = 'Untitled',
    newfile = '', -- Text to show for newly created file before first write
  },

  on_click = function() custom_pickers.find_files() end,
}

M.filetype = {
  'filetype',
  on_click = function() require('telescope.builtin').filetypes() end,
}

return M
