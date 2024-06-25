local LEFT_SEP = ''
local RIGHT_SEP = ''

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

function M.custom_tabline(theme)
  return function(line)
    return {
      {
        { '  ', hl = theme.head },
        line.sep(RIGHT_SEP, theme.head, theme.fill),
      },

      line.tabs().foreach(function(tab)
        local hl = tab.is_current() and theme.current_tab or theme.tab
        local status_icon = { '', '󰆣' }

        return {
          line.sep(LEFT_SEP, hl, theme.fill),
          tab.is_current() and status_icon[1] or status_icon[2],
          tab.number(),
          tab.name(),
          tab.close_btn '',
          line.sep(RIGHT_SEP, hl, theme.fill),

          hl = hl,
          margin = ' ',
        }
      end),

      hl = theme.fill,
    }
  end
end

return M
