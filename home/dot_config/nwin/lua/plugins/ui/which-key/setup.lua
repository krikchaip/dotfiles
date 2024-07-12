local which_key = require 'which-key'

which_key.setup {
  icons = {
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
which_key.register {
  ['<C-,>'] = { name = 'Nvim Settings', _ = 'which_key_ignore' },
  ['<C-t>'] = { name = 'Tab', _ = 'which_key_ignore' },
  ['<C-w>'] = { name = 'Window', _ = 'which_key_ignore' },

  ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },
  ['<leader>g'] = { name = 'Git', _ = 'which_key_ignore' },
  ['<leader>gh'] = { name = 'Git Hunk', _ = 'which_key_ignore' },
  ['<leader>l'] = { name = 'LSP', _ = 'which_key_ignore' },

  ['['] = { name = 'Previous', _ = 'which_key_ignore' },
  [']'] = { name = 'Next', _ = 'which_key_ignore' },
}

which_key.register({
  ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },
  ['<leader>g'] = { name = 'Git', _ = 'which_key_ignore' },
  ['<leader>gh'] = { name = 'Git Hunk', _ = 'which_key_ignore' },

  ['['] = { name = 'Previous', _ = 'which_key_ignore' },
  [']'] = { name = 'Next', _ = 'which_key_ignore' },
}, { mode = 'x' })

which_key.register({
  ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },

  ['['] = { name = 'Previous', _ = 'which_key_ignore' },
  [']'] = { name = 'Next', _ = 'which_key_ignore' },
}, { mode = 'o' })
