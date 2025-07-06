local keymaps = require 'plugins.git.diffview.keymaps'

require('diffview').setup {
  -- makes add/delete lines highlight more subtly
  enhanced_diff_hl = true,

  view = {
    -- left / right and bottom layout
    merge_tool = { layout = 'diff3_mixed' },
  },

  file_panel = {
    -- like with VSCode's
    listing_style = 'list',

    -- Has to match nvim-tree window width
    win_config = { width = 30 },
  },

  keymaps = {
    disable_defaults = true,

    view = keymaps.view(),
    diff_view = keymaps.diff_view(),
    file_panel = keymaps.file_panel(),
    file_history_panel = keymaps.file_history_panel(),
    option_panel = keymaps.option_panel(),
    help_panel = keymaps.help_panel(),
  },
}
