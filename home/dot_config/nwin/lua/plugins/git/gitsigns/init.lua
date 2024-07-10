-- Adds git related signs to the gutter, as well as utilities for managing changes
-- ref: https://github.com/lewis6991/gitsigns.nvim?tab=readme-ov-file
return {
  -- Spec Source
  'lewis6991/gitsigns.nvim',
  name = 'gitsigns',

  -- Spec Setup
  config = function()
    require 'plugins.git.gitsigns.setup'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',

  -- Spec Versioning
  version = '^0.8.0',
}
