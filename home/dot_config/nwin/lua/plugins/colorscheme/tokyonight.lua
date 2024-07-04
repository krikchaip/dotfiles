return {
  -- Spec Source
  'folke/tokyonight.nvim',
  name = 'tokyonight',

  -- Spec Loading
  priority = 1000,

  -- Spec Setup
  config = function()
    require('tokyonight').setup {
      style = 'storm',
      transparent = false,
      styles = {
        floats = 'transparent',
      },
    }

    vim.cmd [[colorscheme tokyonight]]
  end,

  -- Spec Lazy Loading
  lazy = false,
}
