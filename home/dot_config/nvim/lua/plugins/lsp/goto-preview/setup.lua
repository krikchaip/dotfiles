local utils = require 'plugins.lsp.goto-preview.utils'

require('goto-preview').setup {
  width = 80,
  height = 20,

  -- Starting zindex for the stack of floating windows
  zindex = 300,

  -- Whether to set the preview window title as the filename
  preview_window_title = { position = 'center' },

  references = {
    -- Use telescope's default layout configs
    telescope = {},
  },

  post_open_hook = function(bufnr, winnr)
    local actions = utils.create_actions(bufnr, winnr)
    require('plugins.lsp.goto-preview.keymaps').setup(actions)
  end,
}
