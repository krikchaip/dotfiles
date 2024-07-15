require('nvim-navbuddy').setup {
  lsp = { auto_attach = true },

  window = {
    -- "single", "rounded", "double", "solid", "none"
    border = 'rounded',

    -- Or table format example: { height = "40%", width = "100%" }
    -- ref: https://github.com/MunifTanjim/nui.nvim/tree/main/lua/nui/layout#size
    size = { width = '60%', height = 37 },

    -- Or table format example: { row = "100%", col = "0%" }
    -- ref: https://github.com/MunifTanjim/nui.nvim/tree/main/lua/nui/layout#position
    position = { row = '50%', col = '50%' },

    sections = {
      left = { size = '25%' },
      mid = { size = '25%' },

      -- "leaf", "always" or "never"
      right = { preview = 'always' },
    },
  },

  node_markers = {
    icons = {
      leaf_selected = '',
      branch = '  ',
    },
  },

  source_buffer = {
    -- "smart", "top", "mid" or "none"
    reorient = 'smart',
  },

  use_default_mappings = false,
  mappings = require 'plugins.ui.navbuddy.keymaps',
}
