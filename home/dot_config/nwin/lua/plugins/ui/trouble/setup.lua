local utils = require 'plugins.ui.trouble.utils'

require('trouble').setup {
  -- show a warning when there are no results
  warn_no_results = false,

  -- user-defined modes
  modes = {
    diag = {
      mode = 'diagnostics',
      preview = utils.split_preview,
    },

    qf = {
      mode = 'quickfix',
      preview = utils.split_preview,
    },

    ll = {
      mode = 'loclist',
      preview = utils.split_preview,
    },

    todolist = {
      mode = 'todo',
      preview = utils.split_preview,
      filter = { tag = { 'TODO', 'FIX', 'FIXME' } },
    },
  },
}
