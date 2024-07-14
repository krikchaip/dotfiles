return {
  -- Spec Source
  'lukas-reineke/indent-blankline.nvim',
  name = 'indent-blankline',

  -- Spec Loading
  dependencies = { 'rainbow-delimiters' },

  -- Spec Setup
  config = function()
    require 'plugins.ui.indent-blankline.setup'
  end,
  main = 'ibl',

  -- Spec Lazy Loading
  event = 'User FilePost',
}
