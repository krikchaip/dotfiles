local utils = require 'plugins.ui.lualine.utils'

return {
  'fileformat',

  fmt = utils.trunc { hide_width = 80, screen = true },
}
