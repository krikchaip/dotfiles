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

        local has_modified_buffers = #line.wins_in_tab(tab.id, function(win)
          return win.buf().is_changed()
        end).wins <= 0 and '' or tab.is_current() and '●' or { '●', hl = { fg = theme.head.bg, bg = hl.bg } }

        return {
          line.sep(LEFT_SEP, hl, theme.fill),
          tab.number(),
          tab.name(),
          has_modified_buffers,
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

function M.restore_tab_names()
  local tabby_loaded = pcall(require, 'tabby')
  if not tabby_loaded then return end

  local api = require 'tabby.module.api'
  local tab_name = require 'tabby.feature.tab_name'

  local names = vim.g.TabbyTabNames

  local ok, names_to_number = pcall(vim.json.decode, names)
  if not (ok and type(names_to_number) == 'table') then return end

  for _, tabid in ipairs(api.get_tabs()) do
    local tab_num = api.get_tab_number(tabid)
    local name = names_to_number[tostring(tab_num)]

    if name ~= nil then tab_name.set(tabid, name) end
  end
end

return M
