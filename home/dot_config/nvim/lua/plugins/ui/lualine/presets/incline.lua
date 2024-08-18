local components = require 'plugins.ui.lualine.components'

return {
  tabline = {},

  winbar = {},
  inactive_winbar = {},

  sections = {
    lualine_a = { 'mode', components.macro_recording },
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
