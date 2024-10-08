local utils = require 'plugins.ui.incline.utils'

require('incline').setup {
  render = utils.render,

  debounce_threshold = { rising = 50, falling = 10 },

  window = {
    placement = { vertical = 'top', horizontal = 'right' },
    margin = { vertical = 0, horizontal = 1 },

    overlap = {
      tabline = false,
      winbar = false,
      borders = true,
      statusline = false,
    },

    winhighlight = {
      active = {
        Search = 'None',
        EndOfBuffer = 'None',
        Normal = 'InclineNormal',
      },

      inactive = {
        Search = 'None',
        EndOfBuffer = 'None',
        Normal = 'InclineNormalNC',
      },
    },

    width = 'fit',

    padding = 0,
    padding_char = ' ',

    options = {
      signcolumn = 'no',
      wrap = false,
    },

    zindex = 5,
  },

  ignore = {
    unlisted_buffers = true,
    floating_wins = true,
    filetypes = {},
    buftypes = 'special',
    wintypes = 'special',
  },

  hide = {
    cursorline = 'focused_win',
    focused_win = false,
    only_win = false,
  },

  highlight = {
    groups = {
      InclineNormal = { default = true, group = 'NormalFloat' },
      InclineNormalNC = { default = true, group = 'NormalFloat' },
    },
  },
}
