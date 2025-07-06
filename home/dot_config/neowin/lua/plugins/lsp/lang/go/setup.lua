local utils = require 'plugins.lsp.lspconfig.utils'

-- references:
--   settings  -> https://github.com/golang/tools/blob/master/gopls/doc/settings.md
--   analyzers -> https://github.com/golang/tools/blob/master/gopls/doc/analyzers.md
vim.lsp.config(
  'gopls',
  vim.tbl_extend('force', utils.server_config, {
    settings = {
      gopls = {
        templateExtensions = {},
        gofumpt = false,
        usePlaceholders = true,
        analyses = { unusedvariable = true, useany = true },
      },
    },
  })
)
