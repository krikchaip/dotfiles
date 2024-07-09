return {
  -- Spec Source
  'b0o/nvim-tree-preview.lua',
  name = 'nvim-tree-preview',

  -- Spec Loading
  dependencies = { 'plenary', 'nvim-treesitter' },

  -- Spec Setup
  opts = {
    keymaps = {
      ['q'] = { action = 'close', unwatch = true },
      ['P'] = { action = 'toggle_focus' },
      ['<CR>'] = { open = 'edit' },
      ['<C-t>'] = { open = 'tab' },
      ['<C-v>'] = { open = 'vertical' },
      ['<C-s>'] = { open = 'horizontal' },
    },
  },

  -- Spec Versioning
  commit = 'e968df0', -- pinned until displaying filename as floating window title is fixed
}
