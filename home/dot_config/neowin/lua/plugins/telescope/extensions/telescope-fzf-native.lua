-- Help improve Telescope sorting performance
return {
  -- Spec Source
  'nvim-telescope/telescope-fzf-native.nvim',
  name = 'telescope-fzf-native',

  -- Spec Loading
  cond = function()
    return vim.fn.executable 'make' == 1
  end,

  -- Spec Setup
  build = 'make',
}
