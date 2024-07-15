return {
  -- Spec Source
  'SmiteshP/nvim-navbuddy',
  name = 'navbuddy',

  -- Spec Setup
  config = function()
    require 'plugins.ui.navbuddy.setup'
  end,

  -- Spec Lazy Loading
  keys = {
    { '<leader>n', '<cmd>lua require("nvim-navbuddy").open()<CR>', desc = 'NavBuddy: Open Popup' },
  },
}
