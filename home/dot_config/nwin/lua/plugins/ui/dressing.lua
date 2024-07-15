return {
  -- Spec Source
  'stevearc/dressing.nvim',
  name = 'dressing',

  -- Spec Setup
  opts = {
    input = {
      mappings = {
        i = {
          ['<C-c>'] = false, -- press this key to exit insert mode instead
          ['<Esc>'] = 'Close',
        },
      },
    },

    select = {
      -- Options for telescope selector
      -- These are passed into the telescope picker directly. Can be used like:
      -- telescope = require('telescope.themes').get_ivy({...})
      telescope = nil,
    },
  },

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
