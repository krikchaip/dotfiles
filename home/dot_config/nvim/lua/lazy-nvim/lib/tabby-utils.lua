local M = {}

function M.setup_theme(lualine_theme)
  local lualine = string.format('lualine.themes.%s', lualine_theme)
  local ok, theme = pcall(require, lualine)

  if ok then
    return {
      fill = theme.normal.c,
      head = theme.visual.a,
      current_tab = theme.normal.a,
      tab = theme.normal.b,
      win = theme.normal.b,
      tail = theme.normal.b,
    }
  else
    return {
      fill = 'TabLineFill',
      head = 'TabLine',
      current_tab = 'TabLineSel',
      tab = 'TabLine',
      win = 'TabLine',
      tail = 'TabLine',
    }
  end
end

function M.custom_tabline(line) return {} end

return M
