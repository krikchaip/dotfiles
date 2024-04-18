return {
  -- A collection of Nvim utility functions
  {
    'nvim-lua/plenary.nvim',
    name = 'plenary'
  },

  -- Useful for getting pretty icons, but requires a Nerd Font to be installed.
  {
    'nvim-tree/nvim-web-devicons',
    name = 'web-devicons',
    enabled = vim.g.have_nerd_font
  },
}
