return {
  -- A collection of Nvim utility functions
  {
    'nvim-lua/plenary.nvim',
    name = 'plenary',
  },

  -- Useful for getting pretty icons, but requires a Nerd Font to be installed
  {
    'nvim-tree/nvim-web-devicons',
    name = 'web-devicons',
    enabled = vim.g.have_nerd_font,
  },

  -- A Lua version of Javascript's Promise & Async-Await
  {
    'kevinhwang91/promise-async',
    name = 'promise-async',
  },

  -- Allows to amend the existing keybinding in Neovim
  {
    'anuvyklack/keymap-amend.nvim',
    name = 'keymap-amend',
  },

  -- UI Component Library for Neovim
  {
    'MunifTanjim/nui.nvim',
    name = 'nui',
  },
}
