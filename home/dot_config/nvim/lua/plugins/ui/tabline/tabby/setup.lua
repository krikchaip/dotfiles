local utils = require 'plugins.ui.tabline.tabby.utils'

local theme = utils.setup_theme 'auto'

require('tabby').setup {
  line = utils.custom_tabline(theme),
  option = {
    tab_name = { name_fallback = utils.format_tab_name },
  },
}
