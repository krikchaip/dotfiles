return {
  require 'plugins.lsp.diagnostic',
  require 'plugins.lsp.installer',
  require 'plugins.lsp.lspconfig',
  require 'plugins.lsp.goto-preview',

  -- Language support
  require 'plugins.lsp.lang.lua',
  require 'plugins.lsp.lang.typescript',
}
