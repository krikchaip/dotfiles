local M = {}

function M.make_capabilities()
  -- default Nvim LSP client capabilities
  local capabilities = vim.lsp.protocol.make_client_capabilities()

  -- setup LSP capability for nvim-ufo, as we're choosing LSP as its provider
  -- ref: https://github.com/kevinhwang91/nvim-ufo?tab=readme-ov-file#minimal-configuration
  capabilities.textDocument.foldingRange = {
    dynamicRegistration = false,
    lineFoldingOnly = true,
  }

  -- LSP autocomplete integration
  -- ref: https://github.com/hrsh7th/cmp-nvim-lsp
  capabilities = vim.tbl_deep_extend('force', capabilities, require('cmp_nvim_lsp').default_capabilities())

  return capabilities
end

return M
