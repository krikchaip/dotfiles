local components = require 'plugins.ui.lualine.components'

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

    -- which filetypes to always be drawn as inactive statusline
    -- ignore_focus = { 'help' },
  },

  extensions = {},

  tabline = {},

  winbar = {},
  inactive_winbar = {},

  sections = {
    lualine_a = { 'mode', components.macro_recording },
    lualine_b = {},
    lualine_c = {},
    lualine_x = { components.keystrokes },
    lualine_y = { components.filetype },
    lualine_z = { 'searchcount', 'selectioncount', 'location' },
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = {},
    lualine_x = {},
    lualine_y = { components.filetype },
    lualine_z = { 'location' },
  },
}
