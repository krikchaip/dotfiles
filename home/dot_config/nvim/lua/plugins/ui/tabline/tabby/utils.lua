local LEFT_SEP = ''
local RIGHT_SEP = ''

local M = {}

function M.setup_theme(lualine_theme)
  local lualine = string.format('lualine.themes.%s', lualine_theme)
  local ok, theme = pcall(require, lualine)

  if not ok then
    return {
      current = function()
        return {
          head = 'TabLine',
          fill = 'TabLineFill',
          current_tab = 'TabLineSel',
          tab = 'TabLine',
        }
      end,
    }
  end

  return {
    current = function()
      return {
        head = 'TabLine',
        fill = 'TabLineFill',
        current_tab = 'TabLineSel',
        tab = 'TabLine',
      }
    end,
  }

  -- local mode_utils = require 'lualine.utils.mode'
end

function M.custom_tabline(theme)
  return function(line)
    local color = theme.current()

    return {
      {
        { '  ', hl = color.head },
        line.sep(RIGHT_SEP, color.head, color.fill),
      },

      line.tabs().foreach(function(tab)
        local hl = tab.is_current() and color.current_tab or color.tab

        local has_modified_buffers = #line.wins_in_tab(tab.id, function(win)
          return win.buf().is_changed()
        end).wins <= 0 and '' or tab.is_current() and '●' or { '●', hl = { fg = color.head.bg, bg = hl.bg } }

        return {
          line.sep(LEFT_SEP, hl, color.fill),
          tab.number(),
          tab.name(),
          has_modified_buffers,
          tab.close_btn '',
          line.sep(RIGHT_SEP, hl, color.fill),

          hl = hl,
          margin = ' ',
        }
      end),

      hl = color.fill,
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
