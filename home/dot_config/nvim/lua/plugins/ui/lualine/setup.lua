local components = require 'plugins.ui.lualine.components'

local DISABLED_FTS = {
  'DiffviewFileHistory',
  'DiffviewFiles',
  'NvimTree',
  'dashboard',
  'noice',
  'trouble',
}

require('lualine').setup {
  options = {
    -- set `true` to have a single statusline at bottom of instead of one for every window
    globalstatus = false,

    -- sets how often lualine should refresh it's contents (in ms)
    refresh = {
      statusline = 250,
      tabline = 250,
      winbar = 250,
    },

    disabled_filetypes = {
      winbar = list_concat(DISABLED_FTS, { 'qf' }),
      statusline = DISABLED_FTS,
    },

    -- which filetypes to always be drawn as inactive statusline
    -- ignore_focus = { 'help' },
  },

  extensions = {},

  tabline = {},

  winbar = {
    lualine_a = {},
    lualine_b = { unpack(components.filetype_with_icon()) },
    lualine_c = { components.navic },
    lualine_x = {},
    lualine_y = { components.diagnostics },
    lualine_z = { components.macro_recording },
  },
  inactive_winbar = {
    lualine_a = {},
    lualine_b = { unpack(components.filetype_with_icon(true)) },
    lualine_c = {},
    lualine_x = {},
    lualine_y = { components.diagnostics },
    lualine_z = {},
  },

  sections = {
    lualine_a = { 'mode' },
    lualine_b = { components.branch },
    lualine_c = { components.blame_line },
    lualine_x = { 'encoding', 'fileformat' },
    lualine_y = { components.filetype },
    lualine_z = { 'searchcount', 'selectioncount', 'location' },
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = { components.branch },
    lualine_c = { components.blame_line },
    lualine_x = {},
    lualine_y = { components.filetype },
    lualine_z = { 'location' },
  },
}
