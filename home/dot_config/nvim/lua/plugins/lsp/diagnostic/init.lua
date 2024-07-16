return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'lsp', 'diagnostic'),
  name = 'diagnostic',

  -- Spec Setup
  config = function()
    require 'plugins.lsp.diagnostic.setup'
    require 'plugins.lsp.diagnostic.keymaps'
    require 'plugins.lsp.diagnostic.autocmds'
  end,
}
