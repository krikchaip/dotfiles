return {
  -- a package manager for LSP servers, DAP servers linters and formatters
  -- ref: https://github.com/williamboman/mason.nvim
  -- NOTE: is optimized to load as little as possible during setup.
  --       Lazy-loading the plugin, or somehow deferring the setup,
  --       is not recommended.
  {
    'williamboman/mason.nvim',
    name = 'mason',
    opts = {
      ui = {
        icons = {
          package_installed = '✓',
          package_pending = '➜',
          package_uninstalled = '✗'
        },

        -- see https://github.com/williamboman/mason.nvim?tab=readme-ov-file#default-configuration
        keymaps = {},
      },
    },
    config = function(_, opts)
      require('mason').setup(opts)

      vim.keymap.set('n', '<C-S-l>', '<cmd>Mason<CR>', { desc = 'Open Mason popup window' })
    end
  },

  -- closes gaps that exist between mason.nvim and nvim-lspconfig
  -- ref: https://github.com/williamboman/mason-lspconfig.nvim
  {
    'williamboman/mason-lspconfig.nvim',
    name = 'mason-lspconfig',
    dependencies = { 'mason' },
    opts = {
      automatic_installation = true,

      ensure_installed = {
        'lua_ls',
        'html', 'cssls', 'tailwindcss',
        'tsserver',
        'jsonls',
        'marksman',
        'elixirls',
      },
    },
    config = function(_, opts)
      require('mason-lspconfig').setup(opts)
    end
  },

  -- manages Mason package installation and updates
  -- ref: https://github.com/WhoIsSethDaniel/mason-tool-installer.nvim
  -- {
  --   'WhoIsSethDaniel/mason-tool-installer.nvim',
  --   name = 'mason-tool-installer',
  --   dependencies = { 'mason', 'mason-lspconfig' },
  --   opts = {},
  -- },

  -- configures lua_ls for completion, annotations and signatures of Neovim apis
  -- ref: https://github.com/folke/neodev.nvim
  {
    'folke/neodev.nvim',
    name = 'neodev',
    opts = {},
  },

  -- actual configs and apis for the Nvim LSP client
  -- ref: https://github.com/neovim/nvim-lspconfig
  {
    'neovim/nvim-lspconfig',
    name = 'lspconfig',
    dependencies = { 'mason', 'mason-lspconfig', 'neodev' },
    config = function()
      local lspconfig = require 'lspconfig'
      -- local mason_lspconfig = require 'mason-lspconfig'

      vim.keymap.set('n', '<leader>li', '<cmd>LspInfo<CR>', { desc = 'Show LSP [i]nfo for current buffer' })
      vim.keymap.set('n', '<leader>lr', '<cmd>LspRestart<CR>', { desc = '[r]estart running LSP for current buffer' })

      lspconfig.lua_ls.setup {}
    end
  },

  -- Status updates UI for LSP.
  -- ref: https://github.com/j-hui/fidget.nvim
  -- { 'j-hui/fidget.nvim' },
}
