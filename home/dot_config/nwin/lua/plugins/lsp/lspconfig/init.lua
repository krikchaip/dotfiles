-- actual configs and apis for the Nvim LSP client
-- ref: https://github.com/neovim/nvim-lspconfig
return {
  -- Spec Source
  'neovim/nvim-lspconfig',
  name = 'lspconfig',

  -- Spec Loading
  dependencies = { 'diagnostic', 'mason-lspconfig' },

  -- Spec Setup
  config = function() end,

  -- Spec Lazy Loading
  event = { 'BufReadPre', 'BufNewFile' },
  keys = {
    { '<leader>li', '<cmd>LspInfo<CR>', desc = 'LSP: Show Info' },
    { '<leader>lr', '<cmd>LspRestart<CR>', desc = 'LSP: Restart Current' },
  },
}
