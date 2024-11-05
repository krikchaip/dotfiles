return {
  -- Spec Source
  'akinsho/toggleterm.nvim',
  name = 'toggleterm',

  -- Spec Setup
  config = function()
    require 'plugins.editor.toggleterm.setup'
    require 'plugins.editor.toggleterm.keymaps'
    require 'plugins.editor.toggleterm.autocmds'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
