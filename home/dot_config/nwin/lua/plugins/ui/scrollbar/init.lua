return {
  -- Spec Source
  'petertriho/nvim-scrollbar',
  name = 'scrollbar',

  -- Spec Loading
  dependencies = { 'gitsigns', 'hlslens' },

  -- Spec Setup
  config = function()
    require 'plugins.ui.scrollbar.setup'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',
}
