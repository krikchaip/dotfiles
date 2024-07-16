-- NOTE: is optimized to load as little as possible during setup.
--       Lazy-loading the plugin, or somehow deferring the setup,
--       is not recommended.

-- a package manager for LSP servers, DAP servers linters and formatters
-- ref: https://github.com/williamboman/mason.nvim
return {
  -- Spec Source
  'williamboman/mason.nvim',
  name = 'mason',

  -- Spec Setup
  config = function()
    require('mason').setup {
      ui = {
        width = 0.6,
        height = 0.7,

        icons = {
          package_installed = '✓',
          package_pending = '➜',
          package_uninstalled = '✗',
        },

        -- The border to use for the UI window. Accepts same border values as |nvim_open_win()|.
        border = 'rounded',

        -- see https://github.com/williamboman/mason.nvim#default-configuration
        keymaps = {},
      },
    }
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { '<C-S-l>', '<cmd>Mason<CR>', desc = 'Mason: Open Popup' },
  },
}
