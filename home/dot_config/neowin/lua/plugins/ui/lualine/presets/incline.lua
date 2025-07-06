local components = require 'plugins.ui.lualine.components'

return {
  tabline = {},

  winbar = {},
  inactive_winbar = {},

  sections = {
    lualine_a = { 'mode', components.macro_recording },
    lualine_b = { components.branch, components.diagnostics 'workspace' },
    lualine_c = { components.navic },
    lualine_x = { components.blame_line, components.encoding, components.fileformat },
    lualine_y = { components.filetype },
    lualine_z = { 'searchcount', 'selectioncount', 'location' },
  },
  inactive_sections = {},
}
