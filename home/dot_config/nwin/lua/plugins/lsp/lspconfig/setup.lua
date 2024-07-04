local lspconfig = require 'lspconfig'

-- default Nvim LSP client capabilities
local capabilities = vim.lsp.protocol.make_client_capabilities()

-- LSP autocomplete integration
-- ref: https://github.com/hrsh7th/cmp-nvim-lsp
-- capabilities = vim.tbl_deep_extend('force', capabilities, require('cmp_nvim_lsp').default_capabilities())

-- will get run when an LSP attaches to a particular buffer
local on_attach = function(client, bufnr)
  local opts = { buffer = bufnr, silent = true }

  setup_highlight_references_hover(client, bufnr)
  setup_inlay_hints(client, bufnr)

  setup_diagnostic_keymaps(opts)
  setup_lsp_keymaps(opts)
end

require('mason-lspconfig').setup_handlers {
  -- will be called for each installed server that doesn't have a dedicated handler
  function(server_name)
    lspconfig[server_name].setup { capabilities = capabilities, on_attach = on_attach }
  end,
}

-- you need to specify the executable command mannualy for elixir-ls
lspconfig.elixirls.setup { capabilities = capabilities, on_attach = on_attach, cmd = { 'elixir-ls' } }

-- manually setup nushell LSP server as there's no official version found on mason
lspconfig.nushell.setup { capabilities = capabilities, on_attach = on_attach }
