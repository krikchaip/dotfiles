local utils = require 'plugins.ui.indent-blankline.utils'

require('ibl').setup {
  indent = { char = '▏' },

  scope = {
    -- show underline at the start of scope
    show_start = false,

    -- show underline at the end of scope
    show_end = false,

    -- set highlight group for scope char
    highlight = utils.highlight,
  },

  exclude = {
    filetypes = {
      -- default values
      'lspinfo',
      'packer',
      'checkhealth',
      'help',
      'man',
      'gitcommit',
      'TelescopePrompt',
      'TelescopeResults',
      '',

      -- custom values
      'dashboard',
    },

    buftypes = {
      -- default values
      'terminal',
      'nofile',
      'quickfix',
      'prompt',
    },
  },
}

utils.setup_highlights()
