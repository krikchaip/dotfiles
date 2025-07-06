local utils = require 'plugins.ui.ufo.utils'

require('ufo').setup {
  fold_virt_text_handler = utils.folded_number_suffix,

  -- use treesitter as a main provider
  -- (Note: the `nvim-treesitter` plugin is *not* needed.)
  -- ufo uses the same query files for folding (queries/<lang>/folds.scm)
  provider_selector = function(_, filetype, _)
    if vim.tbl_contains(utils.ignored_filetypes, filetype) then return '' end
    return { 'treesitter', 'indent' }
  end,
}
