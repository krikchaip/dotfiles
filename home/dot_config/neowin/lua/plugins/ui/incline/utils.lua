local devicons = require 'nvim-web-devicons'

local LUALINE_THEME = 'lualine.themes.auto'
local LEFT_SEP = '◖'
local RIGHT_SEP = '◗'

local M = {}

local function get_theme(props)
  local ok, lualine_theme = pcall(require, LUALINE_THEME)
  if not ok then return { guifg = '#eeeeee', guibg = '#444444' } end

  local lualine_utils = require 'plugins.ui.lualine.utils'

  local mode = lualine_utils.get_mode()
  local hl = lualine_theme[mode].b
  local hl_inactive = lualine_utils.get_colors 'lualine_b_inactive'

  local theme = { guifg = hl_inactive.fg, guibg = hl_inactive.bg }

  if props.always_highlighted then theme.guifg = hl.fg end

  if props.focused then
    theme.guifg = hl.fg
    theme.guibg = hl.bg
  end

  return theme
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
  local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
  if name == '' then return '[No Name]' end

  local ok, buf_name = pcall(require, 'tabby.feature.buf_name')
  if ok then return buf_name.get(props.buf, { mode = 'unique' }) end

  return name
end

local function modified_icon(props)
  local modified = vim.bo[props.buf].modified
  local icon = modified and { ' ', '●' } or { '' }

  local theme_props = vim.tbl_extend('force', props, { always_highlighted = true })

  return vim.tbl_extend('force', icon, get_theme(theme_props))
end

local function filename_with_icons(props, theme)
  local file_label = filename(props)

  local ft_icon, ft_color = devicons.get_icon_color(file_label)
  local file_icon = ft_icon and { ft_icon, ' ', guifg = ft_color } or ''

  return vim.tbl_extend('force', {
    file_icon,
    file_label,
    modified_icon(props),
  }, theme)
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
