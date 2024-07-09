local M = {}

function M.create_capabilities()
  -- default Nvim LSP client capabilities
  local capabilities = vim.lsp.protocol.make_client_capabilities()

  -- LSP autocomplete integration
  -- ref: https://github.com/hrsh7th/cmp-nvim-lsp
  local cmp_capabilities = require('cmp_nvim_lsp').default_capabilities()
  capabilities = vim.tbl_deep_extend('force', capabilities, cmp_capabilities)

  return capabilities
end

-- will get run when an LSP attaches to a particular buffer
function M.on_attach(client, bufnr)
  local opts = { buffer = bufnr, silent = true }

  setup_highlight_references_hover(client, bufnr)
  setup_inlay_hints(client, bufnr)

  setup_diagnostic_keymaps(opts)
  setup_lsp_keymaps(opts)
end

return M
