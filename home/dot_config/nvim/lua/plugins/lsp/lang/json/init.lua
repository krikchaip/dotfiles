return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'lang', 'json'),
  name = 'json',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    local lspconfig = require 'lspconfig'
    local schemastore = require 'schemastore'
    local utils = require 'plugins.lsp.lspconfig.utils'

    -- ref: https://github.com/b0o/SchemaStore.nvim#usage
    lspconfig.jsonls.setup(vim.tbl_extend('force', utils.server_config, {
      settings = {
        json = {
          format = { enable = false },
          validate = { enable = true },

          schemas = schemastore.json.schemas(),
        },
      },
    }))
  end,

  -- Spec Lazy Loading
  ft = { 'json', 'jsonc' },
}
