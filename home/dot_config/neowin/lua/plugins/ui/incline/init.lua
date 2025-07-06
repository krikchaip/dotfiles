return {
  -- Spec Source
  'b0o/incline.nvim',
  name = 'incline',

  -- Spec Setup
  config = function()
    require 'plugins.ui.incline.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
