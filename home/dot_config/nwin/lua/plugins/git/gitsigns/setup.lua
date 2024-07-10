require('gitsigns').setup {
  signs = {
    add = { text = '┃' },
    change = { text = '┃' },
    delete = { text = '⏵' },
    topdelete = { text = '⏵' },
    changedelete = { text = '~' },
    untracked = { text = '┆' },
  },

  attach_to_untracked = true,

  -- Toggle with `:Gitsigns toggle_signs`
  signcolumn = true,

  -- Toggle with `:Gitsigns toggle_numhl`
  numhl = true,

  -- Toggle with `:Gitsigns toggle_linehl`
  linehl = false,

  -- Toggle with `:Gitsigns toggle_word_diff`
  word_diff = false,

  -- Toggle with `:Gitsigns toggle_current_line_blame`
  current_line_blame = true,

  current_line_blame_opts = {
    -- 'eol' | 'overlay' | 'right_align'
    virt_text_pos = 'eol',
    virt_text_priority = 1000,

    delay = 500,
    ignore_whitespace = true,
  },

  -- mimicking vscode
  current_line_blame_formatter = '     <author>, <author_time:%R> · <summary>',

  on_attach = require 'plugins.git.gitsigns.keymaps',
}
