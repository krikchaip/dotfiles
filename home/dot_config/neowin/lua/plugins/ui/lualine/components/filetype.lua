local utils = require 'plugins.ui.lualine.utils'

return {
  'filetype',

  on_click = function()
    require('telescope.builtin').filetypes()
  end,

  fmt = utils.trunc { hide_width = 60, screen = true },
}
