return {
  -- Spec Source
  'folke/tokyonight.nvim',
  name = 'tokyonight',

  -- Spec Loading
  priority = 1000,

  -- Spec Setup
  config = function()
    require('tokyonight').setup {
      -- The theme comes in four styles, `moon`, `storm`, a darker variant `night` and `day`
      style = 'storm',

      -- Enable this to disable setting the background color
      transparent = false,

      styles = {
        -- Background styles. Can be "dark", "transparent" or "normal"
        floats = 'transparent',
      },

      -- add any plugins here that you want to enable
      -- for all possible plugins, see: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/groups
      plugins = {
        -- enable all plugins highlights
        all = true,
      },
    }

    vim.cmd [[colorscheme tokyonight]]
  end,

  -- Spec Lazy Loading
  lazy = false,
}
