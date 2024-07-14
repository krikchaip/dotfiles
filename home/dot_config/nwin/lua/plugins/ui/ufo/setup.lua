local utils = require 'plugins.ui.ufo.utils'

require('ufo').setup {
  fold_virt_text_handler = utils.folded_number_suffix,
}
