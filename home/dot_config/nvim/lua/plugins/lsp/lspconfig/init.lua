-- actual configs and apis for the Nvim LSP client
-- ref: https://github.com/neovim/nvim-lspconfig
return {
  -- Spec Source
  'neovim/nvim-lspconfig',
  name = 'lspconfig',

  -- Spec Loading
  dependencies = { 'diagnostic', 'mason-lspconfig' },

  -- Spec Setup
  config = function()
    require 'plugins.lsp.lspconfig.autocmds'
    require 'plugins.lsp.lspconfig.keymaps'
    require 'plugins.lsp.lspconfig.setup'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',
  keys = {
    { '<leader>li', '<cmd>LspInfo<CR>', desc = 'LSP: Show Info' },
    { '<leader>lr', '<cmd>LspRestart<CR>', desc = 'LSP: Restart Current' },
  },
}
