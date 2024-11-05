-- ref: https://github.com/nvim-lualine/lualine.nvim/blob/master/lua/lualine/highlight.lua#L20-L35
local mode_mapper = {
  ['VISUAL'] = 'visual',
  ['V-BLOCK'] = 'visual',
  ['V-LINE'] = 'visual',
  ['SELECT'] = 'visual',
  ['S-LINE'] = 'visual',
  ['S-BLOCK'] = 'visual',
  ['REPLACE'] = 'replace',
  ['V-REPLACE'] = 'replace',
  ['INSERT'] = 'insert',
  ['COMMAND'] = 'command',
  ['EX'] = 'command',
  ['MORE'] = 'command',
  ['CONFIRM'] = 'command',
  ['TERMINAL'] = 'terminal',
}

local M = {}

function M.get_mode()
  return mode_mapper[require('lualine.utils.mode').get_mode()] or 'normal'
end

--- @param hl_group string
--- @return table colors \#rrggbb formatted colors
function M.get_colors(hl_group)
  ---@diagnostic disable-next-line: return-type-mismatch, missing-parameter
  return require('lualine.utils.utils').extract_highlight_colors(hl_group)
end

--- @class TruncateOptions
--- @field trunc_width? number truncates component when screen width is less then trunc_width
--- @field trunc_len? number truncates component to trunc_len number of chars
--- @field hide_width? number hides component when window width is smaller then hide_width
--- @field no_ellipsis? boolean whether to disable adding '...' at end after truncation
--- @field screen? boolean uses screen width instead of window width

--- @param opts? TruncateOptions
--- @return function fmt a function that can format the component accordingly
function M.trunc(opts)
  opts = opts or {}

  local trunc_width = opts.trunc_width
  local trunc_len = opts.trunc_len
  local hide_width = opts.hide_width
  local no_ellipsis = opts.no_ellipsis
  local screen = opts.screen or false

  return function(str)
    local width = screen and vim.o.columns or vim.fn.winwidth(0)

    if hide_width and width < hide_width then
      return ''
    elseif trunc_width and trunc_len and width < trunc_width and #str > trunc_len then
      return str:sub(1, trunc_len) .. (no_ellipsis and '' or '...')
    end

    return str
  end
end

return M
