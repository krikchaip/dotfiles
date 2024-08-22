local devicons = require 'nvim-web-devicons'

local M = {}

local function filename(props)
  local ok, buf_name = pcall(require, 'tabby.feature.buf_name')

  if ok then return buf_name.get_unique_name(props.win) end

  local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
  if name == '' then name = '[No Name]' end

  return name
end

local function filename_with_icons(props)
  local file_label = filename(props)
  local modified = vim.bo[props.buf].modified

  local ft_icon, ft_color = devicons.get_icon_color(file_label)
  local file_icon = ft_icon and { ' ', ft_icon, ' ', guifg = ft_color } or ' '

  local modifed_hl = props.focused and {} or { guifg = vim.fn.printf('#%x', vim.api.nvim_get_hl(0, { name = 'lualine_b_visual' }).fg) }
  local modified_icon = modified and vim.tbl_extend('force', { ' ', '●', ' ' }, modifed_hl) or ' '

  return {
    file_icon,
    file_label,
    modified_icon,
  }
end

local function file_diagnostics(props)
  local render = {}

  for severity, icon in pairs(vim.g.diagnostic_signs) do
    local n = #vim.diagnostic.get(props.buf, { severity = vim.diagnostic.severity[string.upper(severity)] })
    if n > 0 then table.insert(render, { ' ', icon, ' ', n, group = 'DiagnosticSign' .. severity }) end
  end

  if #render > 0 then table.insert(render, { ' ', '|' }) end

  return render
end

M.render = function(props)
  return {
    file_diagnostics(props),
    filename_with_icons(props),

    group = props.focused and 'lualine_b_normal' or 'lualine_b_inactive',
  }
end

return M
