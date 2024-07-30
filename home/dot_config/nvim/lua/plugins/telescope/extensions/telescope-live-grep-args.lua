-- Enable passing arguments directly to `rg`
-- ref: https://github.com/nvim-telescope/telescope-live-grep-args.nvim
return {
  -- Spec Source
  'nvim-telescope/telescope-live-grep-args.nvim',
  name = 'telescope-live-grep-args',

  -- Spec Loading
  dependencies = { 'telescope' },

  -- Spec Setup
  config = function()
    require('telescope').load_extension 'live_grep_args'
  end,

  -- Spec Lazy Loading
  keys = {
    { '<leader>F', '<cmd>lua require("telescope").extensions.live_grep_args.live_grep_args()<CR>', desc = 'Search: Embeded Ripgrep' },
  },

  -- Spec Versioning
  version = '^1.1.0',
}
