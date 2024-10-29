return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'lang', 'nushell'),
  name = 'nushell',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    local lspconfig = require 'lspconfig'
    local utils = require 'plugins.lsp.lspconfig.utils'

    -- manually setup nushell LSP server as there's no official version found on mason
    lspconfig.nushell.setup(utils.server_config)
  end,

  -- Spec Lazy Loading
  ft = { 'nu' },
}
