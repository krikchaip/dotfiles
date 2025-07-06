return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'lang', 'elixir'),
  name = 'elixir',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    local utils = require 'plugins.lsp.lspconfig.utils'

    -- you need to specify the executable command mannualy for elixir-ls
    vim.lsp.config(
      'elixirls',
      vim.tbl_extend('force', utils.server_config, {
        cmd = { 'elixir-ls' },
      })
    )
  end,

  -- Spec Lazy Loading
  ft = {
    'elixir',
    'eelixir',
    'heex',
  },
}
