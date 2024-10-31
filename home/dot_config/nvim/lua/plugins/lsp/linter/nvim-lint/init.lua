return {
  -- Spec Source
  'mfussenegger/nvim-lint',
  name = 'nvim-lint',

  -- Spec Setup
  config = function()
    local lint = require 'lint'

    lint.linters_by_ft = {
      javascript = { 'eslint_d' },
      typescript = { 'eslint_d' },
      javascriptreact = { 'eslint_d' },
      typescriptreact = { 'eslint_d' },
      elixir = { 'credo' },
      go = { 'golangcilint' },
    }

    require 'plugins.lsp.linter.nvim-lint.autocmds'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',
}
