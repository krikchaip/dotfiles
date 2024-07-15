-- TODO: create a new telescope picker for this one to replace `builtin.buffers`
--       or wait until https://github.com/nanozuki/tabby.nvim/issues/143 is finished
--       ref: https://github.com/nanozuki/tabby.nvim/blob/main/lua/tabby/feature/win_picker.lua#L16
return {
  -- Spec Source
  'nanozuki/tabby.nvim',
  name = 'tabby',

  -- Spec Setup
  config = function()
    require 'plugins.ui.tabline.tabby.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<C-t>r', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },
    { '<C-t><C-r>', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },

    { '<C-t>p', '<cmd>Tabby pick_window<CR>', desc = 'Tab: Pick Window' },
    { '<C-t><C-p>', '<cmd>Tabby pick_window<CR>', desc = 'Tab: Pick Window' },
  },
}
