return {
  -- Spec Source
  'kevinhwang91/nvim-hlslens',
  name = 'hlslens',

  config = function()
    require 'plugins.ui.hlslens.setup'
    require 'plugins.ui.hlslens.keymaps'
  end,

  -- Spec Lazy Loading
  keys = { '/', '?' },
}
