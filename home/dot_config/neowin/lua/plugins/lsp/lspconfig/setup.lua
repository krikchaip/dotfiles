local mason_lspconfig = require 'mason-lspconfig'
local utils = require 'plugins.lsp.lspconfig.utils'

for _, name in ipairs(mason_lspconfig.get_installed_servers()) do
  vim.lsp.config(name, utils.server_config)
end

mason_lspconfig.setup()
