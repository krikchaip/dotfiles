local LEFT_SEP = ''
local RIGHT_SEP = ''

local function list_tab_wins(tabid)
  local api = require 'tabby.module.api'
  local tab_wins = api.get_tab_wins(tabid)

  return vim.tbl_filter(function(winid)
    local bufid = api.get_win_buf(winid)
    return api.get_buf_type(bufid) ~= 'nofile'
  end, tab_wins)
end

local function tab_icon(tab, hl)
  local ok, devicons = pcall(require, 'nvim-web-devicons')
  if not ok then return '' end

  local tab_name = require 'tabby.feature.tab_name'
  if tab_name.get_raw(tab.id) ~= '' then return '' end

  local win = tab.current_win()
  local ft_icon, ft_color = devicons.get_icon_color(win.buf_name())

  local icon_hl = { fg = tab.is_current() and hl.fg or ft_color, bg = hl.bg }

  return ft_icon and { ft_icon, hl = icon_hl } or ''
end

local M = {}

function M.setup_theme(lualine_theme)
  local lualine = string.format('lualine.themes.%s', lualine_theme)
  local ok, theme = pcall(require, lualine)

  if not ok then
    return {
      current = function()
        return {
          fill = 'TabLineFill',
          head = 'TabLine',
          current_tab = 'TabLineSel',
          tab = 'TabLine',
        }
      end,
    }
  end

  local lualine_utils = require 'plugins.ui.lualine.utils'

  return {
    current = function()
      local mode = lualine_utils.get_mode()

      return {
        fill = theme.normal.c,
        head = theme[mode].a,
        current_tab = theme[mode].a,
        tab = theme[mode].b,
      }
    end,
  }
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
        end).wins <= 0 and '' or '●'

        return {
          line.sep(LEFT_SEP, hl, color.fill),
          tab.number(),
          tab_icon(tab, hl),
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

function M.format_tab_name(tabid)
  local api = require 'tabby.module.api'
  local buf_name = require 'tabby.feature.buf_name'

  local wins = list_tab_wins(tabid)
  local cur_win = api.get_tab_current_win(tabid)
  local cur_buf = api.get_win_buf(cur_win)

  local ft = vim.api.nvim_get_option_value('filetype', { buf = cur_buf })

  local name = ''

  if api.is_float_win(cur_win) then
    name = '[Floating]'
  elseif ft == 'NvimTree' then
    name = '󰙅 File Explorer'
  else
    name = buf_name.get_tail_name(cur_win)
  end

  if vim.wo[cur_win].diff or string.match(ft, 'Diffview') then
    name = string.format('%s  ', name)
  elseif #wins > 1 then
    name = string.format('%s(%d)', name, #wins)
  end

  return name
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

function M.win_select()
  local api = require 'tabby.module.api'
  local buf_name = require 'tabby.feature.buf_name'
  local tabwins = require 'tabby.feature.tabwins'

  local wins = tabwins.new_wins(api.get_wins(), {}).wins

  vim.ui.select(wins, {
    format_item = function(win)
      local tabname = win.tab().name()
      local filename = buf_name.get_unique_name(win.id)

      return string.format('Tab %s: %s', tabname, filename)
    end,
  }, function(win)
    if not win then return end
    vim.api.nvim_set_current_win(win.id)
  end)
end

return M
