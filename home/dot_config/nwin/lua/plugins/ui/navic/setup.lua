local utils = require 'plugins.ui.navic.utils'

require('nvim-navic').setup {
  highlight = true,
  depth_limit = 3,
  click = true,
  lsp = { auto_attach = true },
}

utils.setup_highlights()
