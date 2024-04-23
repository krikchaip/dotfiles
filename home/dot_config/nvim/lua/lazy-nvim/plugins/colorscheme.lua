return {
  {
    'folke/tokyonight.nvim',
    name = 'colorscheme.tokyonight',
    priority = 1000,
    lazy = false,
    config = function()
      require('tokyonight').setup {
        style = 'storm',
        transparent = false,
      }

      vim.cmd [[colorscheme tokyonight]]
    end,
  },

  {
    'loctvl842/monokai-pro.nvim',
    name = 'colorscheme.monokai-pro',
    priority = 1000,
    -- lazy = false,
    config = function()
      require('monokai-pro').setup {
        filter = 'pro',
        transparent_background = false,
      }

      vim.cmd [[colorscheme monokai-pro]]
    end,
  },
}
