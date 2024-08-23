local devicons = require 'nvim-web-devicons'

local LUALINE_THEME = 'lualine.themes.auto'
local LEFT_SEP = '◖'
local RIGHT_SEP = '◗'

local M = {}

local function separator(symbol, theme)
  return vim.tbl_extend('force', { symbol }, theme)
end

local function file_diagnostics(props, theme)
  local render = {}

  for severity, icon in pairs(vim.g.diagnostic_signs) do
    local n = #vim.diagnostic.get(props.buf, { severity = vim.diagnostic.severity[string.upper(severity)] })
    if n > 0 then table.insert(render, { icon, ' ', n, ' ', group = 'DiagnosticSign' .. severity }) end
  end

  if #render > 0 then table.insert(render, { '|', ' ' }) end

  return vim.tbl_extend('force', render, theme)
end

local function filename(props)
  local ok, buf_name = pcall(require, 'tabby.feature.buf_name')

  if ok then return buf_name.get_unique_name(props.win) end

  local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
  if name == '' then name = '[No Name]' end

  return name
end

local function filename_with_icons(props, theme)
  local file_label = filename(props)

  local ft_icon, ft_color = devicons.get_icon_color(file_label)
  local file_icon = ft_icon and { ft_icon, ' ', guifg = ft_color } or ''

  local modified = vim.bo[props.buf].modified
  local modified_icon = modified and { ' ', '●' } or ''

  return vim.tbl_extend('force', {
    file_icon,
    file_label,
    modified_icon,
  }, theme)
end

local function get_theme(props)
  local ok, lualine_theme = pcall(require, LUALINE_THEME)
  if not ok then return { guifg = '#eeeeee', guibg = '#444444' } end

  local lualine_utils = require 'plugins.ui.lualine.utils'

  if props.focused then
    local mode = lualine_utils.get_mode()
    local hl = lualine_theme[mode].b

    return { guifg = hl.fg, guibg = hl.bg }
  end

  return { group = 'lualine_b_inactive' }
end

local function get_theme_sep(props)
  local ok, lualine_theme = pcall(require, LUALINE_THEME)
  if not ok then return { guifg = '#444444' } end

  local lualine_utils = require 'plugins.ui.lualine.utils'
  local highlight = require 'lualine.highlight'

  if props.focused then
    local mode = lualine_utils.get_mode()
    local hl = lualine_theme[mode].b

    return { guifg = hl.bg }
  end

  return { guifg = highlight.get_lualine_hl('lualine_b_inactive').bg }
end

M.render = function(props)
  local theme = get_theme(props)
  local theme_sep = get_theme_sep(props)

  return {
    separator(LEFT_SEP, theme_sep),
    file_diagnostics(props, theme),
    filename_with_icons(props, theme),
    separator(RIGHT_SEP, theme_sep),
  }
end

return M
