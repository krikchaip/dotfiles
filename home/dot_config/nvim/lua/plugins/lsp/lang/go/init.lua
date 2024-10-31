return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'lang', 'go'),
  name = 'go',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    require 'plugins.lsp.lang.go.setup'
    require 'plugins.lsp.lang.go.autocmds'
  end,

  -- Spec Lazy Loading
  ft = {
    'go',
    'gomod',
    'gotmpl',
    'gowork',
  },
}
