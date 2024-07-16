local utils = require 'plugins.editor.window-picker.utils'

return {
  -- Spec Source
  's1n7ax/nvim-window-picker',
  name = 'window-picker',

  -- Spec Setup
  config = function()
    require 'plugins.editor.window-picker.setup'
  end,

  -- Spec Lazy Loading
  keys = {
    { '<C-w><C-w>', utils.pick_window, desc = 'Window: Switch to Selection' },
    { '<C-w>w', utils.pick_window, desc = 'Window: Switch to Selection' },
  },

  -- Spec Versioning
  version = '2.*',
}
