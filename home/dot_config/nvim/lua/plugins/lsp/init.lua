return {
  require 'plugins.lsp.diagnostic',
  require 'plugins.lsp.installer',
  require 'plugins.lsp.lspconfig',
  require 'plugins.lsp.goto-preview',
  require 'plugins.lsp.linter',
  require 'plugins.lsp.formatter',

  -- Language support
  require 'plugins.lsp.lang.elixir',
  require 'plugins.lsp.lang.go',
  require 'plugins.lsp.lang.json',
  require 'plugins.lsp.lang.lua',
  require 'plugins.lsp.lang.nushell',
  require 'plugins.lsp.lang.typescript',
  require 'plugins.lsp.lang.yaml',
}
