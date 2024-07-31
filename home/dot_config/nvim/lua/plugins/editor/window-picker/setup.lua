require('window-picker').setup {
  -- available options: 'statusline-winbar' | 'floating-big-letter'
  hint = 'floating-big-letter',

  -- whether to show 'Pick window:' prompt
  show_prompt = false,

  -- when you go to window selection mode, status bar will show one of
  -- following letters on them so you can use that letter to select the window
  selection_chars = 'JKLIMOP',

  -- exclude buffers/windows with the following options
  filter_rules = {
    bo = {
      filetype = { 'fidget', 'NvimTree' },
    },

    wo = {
      winhl = { 'NormalFloat:TreesitterContext', 'NormalFloat:TreesitterContextLineNumber' },
    },
  },
}
