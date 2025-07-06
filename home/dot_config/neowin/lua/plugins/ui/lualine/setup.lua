local presets = require 'plugins.ui.lualine.presets'

local BASE_OPTS = {
  options = {
    -- set `true` to have a single statusline at bottom of instead of one for every window
    globalstatus = true,

    -- sets how often lualine should refresh it's contents (in ms)
    refresh = {
      statusline = 250,
      tabline = 250,
      winbar = 250,
    },

    disabled_filetypes = {
      statusline = { 'dashboard' },
    },

    -- which filetypes to always be drawn as inactive statusline
    -- ignore_focus = { 'help' },
  },

  extensions = {},
}

local SELECTED_PRESET = presets['incline']

require('lualine').setup(vim.tbl_deep_extend('force', BASE_OPTS, SELECTED_PRESET))
