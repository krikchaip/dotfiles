local lspconfig = require 'lspconfig'
local utils = require 'plugins.lsp.lspconfig.utils'

require('mason-lspconfig').setup_handlers {
  -- will be called for each installed server that doesn't have a dedicated handler
  function(server_name)
    lspconfig[server_name].setup(utils.server_config)
  end,
}

-- manually setup nushell LSP server as there's no official version found on mason
lspconfig.nushell.setup(utils.server_config)
