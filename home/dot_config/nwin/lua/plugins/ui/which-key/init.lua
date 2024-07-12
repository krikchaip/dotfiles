-- Useful plugin to show you pending keybinds.
-- ref: https://github.com/folke/which-key.nvim
return {
  -- Spec Source
  'folke/which-key.nvim',
  name = 'which-key',

  -- Spec Setup
  config = function()
    require 'plugins.ui.which-key.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
