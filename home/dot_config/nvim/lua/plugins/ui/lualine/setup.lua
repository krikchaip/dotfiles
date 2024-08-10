local presets = require 'plugins.ui.lualine.presets'

local DISABLED_FTS = {
  'DiffviewFileHistory',
  'DiffviewFiles',
  'NvimTree',
  'dashboard',
  'noice',
  'trouble',
}

local BASE_OPTS = {
  options = {
    -- set `true` to have a single statusline at bottom of instead of one for every window
    globalstatus = false,

    -- sets how often lualine should refresh it's contents (in ms)
    refresh = {
      statusline = 250,
      tabline = 250,
      winbar = 250,
    },

    disabled_filetypes = {
      winbar = list_concat(DISABLED_FTS, { 'qf' }),
      statusline = DISABLED_FTS,
    },

    -- which filetypes to always be drawn as inactive statusline
    -- ignore_focus = { 'help' },
  },

  extensions = {},
}

require('lualine').setup(vim.tbl_extend('force', BASE_OPTS, presets.default))
