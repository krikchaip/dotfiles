local utils = require 'plugins.ui.lualine.utils'

return {
  'encoding',

  fmt = utils.trunc { hide_width = 80, screen = true },
}
