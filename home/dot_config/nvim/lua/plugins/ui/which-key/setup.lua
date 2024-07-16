local which_key = require 'which-key'

which_key.setup {
  ---@type false | "classic" | "modern" | "helix"
  preset = 'modern',

  -- see https://github.com/folke/which-key.nvim/blob/main/lua/which-key/view.lua#L18 for more info
  sort = {
    'group',
    'desc',
  },

  icons = {
    --- See `lua/which-key/icons.lua` for more details
    --- Set to `false` to disable keymap icons
    ---@type wk.IconRule[]|false
    rules = {},

    -- symbol used in the command line area that shows your active key combo
    breadcrumb = '»',

    -- symbol used between a key and it's label
    separator = '>',

    -- symbol prepended to a group
    group = '+',
  },
}

-- Document existing key chains
-- see: https://github.com/folke/which-key.nvim?tab=readme-ov-file#-setup
which_key.add {
  { '<C-,>', group = 'Nvim Settings' },
  { '<C-t>', group = 'Tab' },
  { '<C-w>', group = 'Window' },

  { '<leader>', group = 'Special' },
  { '<leader>g', group = 'Git' },
  { '<leader>gh', group = 'Git Hunk' },
  { '<leader>l', group = 'LSP' },

  { '[', group = 'Previous' },
  { ']', group = 'Next' },
}

which_key.add {
  { mode = 'x' },

  { '<leader>', group = 'Special' },
  { '<leader>g', group = 'Git' },
  { '<leader>gh', group = 'Git Hunk' },

  { '[', group = 'Previous' },
  { ']', group = 'Next' },
}

which_key.add {
  mode = { 'o' },

  { '<leader>', group = 'Special' },

  { '[', group = 'Previous' },
  { ']', group = 'Next' },
}
