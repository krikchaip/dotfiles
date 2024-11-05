require('toggleterm').setup {
  open_mapping = '<C-\\>', -- the key to use for toggling the terminal

  insert_mappings = true, -- whether if the mapping also take effect in insert mode
  terminal_mappings = true, -- whether if the mapping also take effect inside a terminal

  autochdir = true, -- auto change the terminal's cwd on next open
  start_in_insert = true, -- start terminal in insert mode on open

  direction = 'horizontal', -- 'vertical' | 'horizontal' | 'tab' | 'float'

  float_opts = {
    border = 'rounded', -- see :h nvim_open_win for details
    title_pos = 'right', -- 'left' | 'center' | 'right'
  },

  highlights = {
    FloatBorder = { link = 'FloatBorder' },
  },

  responsiveness = {
    -- columns breakpoint at which terminals will start to
    -- stack on top of each other instead of next to each other
    horizontal_breakpoint = 135,
  },
}
