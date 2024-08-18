local utils = require 'plugins.ui.incline.utils'

require('incline').setup {
  render = utils.render,

  debounce_threshold = {
    falling = 50,
    rising = 10,
  },

  hide = {
    cursorline = false,
    focused_win = false,
    only_win = false,
  },

  highlight = {
    groups = {
      InclineNormal = { default = true, group = 'NormalFloat' },
      InclineNormalNC = { default = true, group = 'NormalFloat' },
    },
  },

  ignore = {
    buftypes = 'special',
    wintypes = 'special',
    unlisted_buffers = true,
    floating_wins = true,
    filetypes = {},
  },

  window = {
    width = 'fit',

    padding = 1,
    padding_char = ' ',

    margin = { vertical = 1, horizontal = 1 },

    placement = { vertical = 'top', horizontal = 'right' },

    options = {
      signcolumn = 'no',
      wrap = false,
    },

    overlap = {
      borders = true,
      tabline = false,
      winbar = false,
      statusline = false,
    },

    winhighlight = {
      active = {
        EndOfBuffer = 'None',
        Normal = 'InclineNormal',
        Search = 'None',
      },

      inactive = {
        EndOfBuffer = 'None',
        Normal = 'InclineNormalNC',
        Search = 'None',
      },
    },

    zindex = 50,
  },
}
