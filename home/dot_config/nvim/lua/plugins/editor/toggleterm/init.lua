return {
  -- Spec Source
  'akinsho/toggleterm.nvim',
  name = 'toggleterm',

  -- Spec Setup
  config = function()
    require 'plugins.editor.toggleterm.setup'
  end,

  -- Spec Lazy Loading
  keys = {
    { '<C-\\>', desc = 'Toggle Terminal', mode = { 'n', 'i' } },
  },
}
