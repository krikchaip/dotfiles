return {
  -- Spec Source
  'SmiteshP/nvim-navic',
  name = 'navic',

  -- Spec Setup
  config = function()
    require 'plugins.ui.navic.setup'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost'
}
