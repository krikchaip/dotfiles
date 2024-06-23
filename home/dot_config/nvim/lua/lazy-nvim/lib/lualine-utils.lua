---@diagnostic disable: missing-parameter, param-type-mismatch, unused-local, unused-function

local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'
local navic_utils = require 'lazy-nvim.lib.navic-utils'

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

M.blame_line = {
  (function()
    local blame_line_cache = {}

    return function()
      local utils = require 'gitsigns.util'

      local buf = vim.api.nvim_get_current_buf()
      local gitsigns = vim.b.gitsigns_blame_line_dict

      if not blame_line_cache[buf] then blame_line_cache[buf] = '' end
      if not gitsigns then return blame_line_cache[buf] end

      local author = ''
      local time = ''

      if gitsigns.author then author = gitsigns.author end
      if gitsigns.author_time then time = utils.get_relative_time(gitsigns.author_time) end

      local result

      if author == 'Not Committed Yet' then
        result = author
      else
        result = author .. ', ' .. time
      end

      blame_line_cache[buf] = result

      return result
    end
  end)(),

  icon = '',

  on_click = function() require('gitsigns').blame_line { full = true } end,

  fmt = trunc(nil, nil, 60),
}

M.branch = {
  -- 'branch',

  'b:gitsigns_head',
  icon = '',

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

M.diff = {
  'diff',

  source = function()
    local gitsigns = vim.b.gitsigns_status_dict

    if gitsigns then return {
      added = gitsigns.added,
      modified = gitsigns.changed,
      removed = gitsigns.removed,
    } end
  end,

  on_click = function() vim.cmd [[ DiffviewOpen ]] end,
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

M.navic = {
  'navic',

  -- All options except "lsp" options take effect when set here
  navic_opts = {
    highlight = true,
    click = true,
    depth_limit = 3,
  },

  -- "static" -> perform an adjustment once when the component is being setup.
  --   This should be enough when the lualine section isn't changing colors based on the mode.
  -- "dynamic" -> keep updating the highlights according to the current modes colors
  --   for the current section.
  color_correction = 'dynamic',

  -- uncomment this line when you put navic into lualine_a or lualine_b
  -- ref: https://github.com/SmiteshP/nvim-navic/issues/115
  -- padding = { left = 1, right = 0 },

  fmt = navic_utils.adjust_dynamic_highlights(),
}

return M
