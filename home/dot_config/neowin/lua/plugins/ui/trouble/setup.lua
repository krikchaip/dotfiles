local utils = require 'plugins.ui.trouble.utils'

require('trouble').setup {
  -- show a warning when there are no results
  warn_no_results = false,

  -- user-defined modes
  modes = {
    diag = {
      mode = 'diagnostics',
      preview = utils.preview_window_opts,
    },

    todolist = {
      mode = 'todo',
      preview = utils.preview_window_opts,
      filter = { tag = { 'TODO', 'FIX', 'FIXME' } },
    },
  },
}
