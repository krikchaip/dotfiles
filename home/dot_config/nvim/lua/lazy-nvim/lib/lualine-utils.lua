---@diagnostic disable: missing-parameter, param-type-mismatch, unused-local, unused-function

local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

--- @param trunc_width number trunctates component when screen width is less then trunc_width
--- @param trunc_len number truncates component to trunc_len number of chars
--- @param hide_width number hides component when window width is smaller then hide_width
--- @param no_ellipsis boolean whether to disable adding '...' at end after truncation
--- return function that can format the component accordingly
local function trunc(trunc_width, trunc_len, hide_width, no_ellipsis)
  return function(str)
    local win_width = vim.fn.winwidth(0)

    if hide_width and win_width < hide_width then
      return ''
    elseif trunc_width and trunc_len and win_width < trunc_width and #str > trunc_len then
      return str:sub(1, trunc_len) .. (no_ellipsis and '' or '...')
    end

    return str
  end
end

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

M.lsp_progress = {
  'lsp_progress',

  colors = { use = true },

  -- spinner_symbols = { '▙', '▛', '▜', '▟' },
  spinner_symbols = { '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘' },

  display_components = { 'spinner', { 'title', 'percentage' } },
}

return M
