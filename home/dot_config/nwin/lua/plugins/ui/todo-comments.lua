return {
  -- Spec Source
  'folke/todo-comments.nvim',
  name = 'todo-comments',

  -- Spec Setup
  config = function()
    require('todo-comments').setup {
      highlight = {
        -- lua pattern to match the next multiline from the start of the matched keyword
        multiline_pattern = '^%s+',
      },
    }
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  cmd = { 'TodoQuickFix', 'TodoLocList', 'TodoTelescope' },
  keys = {
    { ']t', '<cmd>lua require("todo-comments").jump_next()<CR>', desc = 'Todo: Comment' },
    { '[t', '<cmd>lua require("todo-comments").jump_prev()<CR>', desc = 'Todo: Comment' },
  },
}
