return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'lang', 'go'),
  name = 'go',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    local lspconfig = require 'lspconfig'
    local utils = require 'plugins.lsp.lspconfig.utils'

    -- references:
    --   settings  -> https://github.com/golang/tools/blob/master/gopls/doc/settings.md
    --   analyzers -> https://github.com/golang/tools/blob/master/gopls/doc/analyzers.md
    lspconfig.gopls.setup(vim.tbl_extend('force', utils.server_config, {
      settings = {
        gopls = {
          templateExtensions = {},
          gofumpt = false,
          usePlaceholders = true,
          analyses = { unusedvariable = true, useany = true },
        },
      },
    }))
  end,

  -- Spec Lazy Loading
  ft = {
    'go',
    'gomod',
    'gotmpl',
    'gowork',
  },
}
