local utils = require 'plugins.ui.lualine.utils'

local blame_line = require('gitsigns').blame_line
local get_relative_time = require('gitsigns.util').get_relative_time

local blame_line_cache = {}

local function render()
  local buf = vim.api.nvim_get_current_buf()
  local gitsigns = vim.b.gitsigns_blame_line_dict

  if not blame_line_cache[buf] then blame_line_cache[buf] = '' end
  if not gitsigns then return blame_line_cache[buf] end

  local author = ''
  local time = ''

  if gitsigns.author then author = gitsigns.author end
  if gitsigns.author_time then time = get_relative_time(gitsigns.author_time) end

  local result

  if author == 'Not Committed Yet' then
    result = author
  else
    result = author .. ', ' .. time
  end

  blame_line_cache[buf] = result

  return result
end

return {
  render,

  icon = '',

  on_click = function()
    blame_line { full = true }
  end,

  fmt = utils.trunc { hide_width = 100, screen = true },
}
