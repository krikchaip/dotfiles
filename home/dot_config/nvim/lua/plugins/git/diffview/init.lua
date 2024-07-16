return {
  -- Spec Source
  'sindrets/diffview.nvim',
  name = 'diffview',

  -- Spec Setup
  config = function()
    require 'plugins.git.diffview.setup'
  end,

  -- Spec Lazy Loading
  cmd = { 'DiffviewOpen', 'DiffviewFileHistory' },
  keys = require('plugins.git.diffview.keymaps').lazy(),
}
