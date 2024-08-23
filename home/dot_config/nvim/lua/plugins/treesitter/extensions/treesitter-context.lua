-- context sticky scroll
-- ref: https://github.com/nvim-treesitter/nvim-treesitter-context
return {
  -- Spec Source
  'nvim-treesitter/nvim-treesitter-context',
  name = 'treesitter-context',

  -- Spec Setup
  opts = {
    enable = true,

    -- How many lines the window should span. Values <= 0 mean no limit.
    max_lines = 4,

    -- The Z-index of the context window
    zindex = 1,

    -- Maximum number of lines to show for a single context
    multiline_threshold = 1,
  },

  -- Spec Lazy Loading
  event = 'User FilePost',
  keys = {
    { '[C', '<cmd>lua require("treesitter-context").go_to_context(vim.v.count1)<CR>', desc = 'Treesitter: Parent Context' },
  },
}
