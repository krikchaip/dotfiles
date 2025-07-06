local components = require 'plugins.ui.lualine.components'

return {
  tabline = {},

  winbar = {
    lualine_a = {},
    lualine_b = { unpack(components.filetype_with_icon()) },
    lualine_c = { components.navic },
    lualine_x = {},
    lualine_y = { components.diagnostics() },
    lualine_z = { components.macro_recording },
  },
  inactive_winbar = {
    lualine_a = {},
    lualine_b = { unpack(components.filetype_with_icon(true)) },
    lualine_c = {},
    lualine_x = {},
    lualine_y = { components.diagnostics() },
    lualine_z = {},
  },

  sections = {
    lualine_a = { 'mode' },
    lualine_b = { components.branch },
    lualine_c = { components.blame_line },
    lualine_x = { components.encoding, components.fileformat },
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
