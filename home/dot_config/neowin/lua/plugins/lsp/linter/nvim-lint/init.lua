return {
  -- Spec Source
  'mfussenegger/nvim-lint',
  name = 'nvim-lint',

  -- Spec Setup
  config = function()
    local lint = require 'lint'
    local util = require 'lint.util'

    lint.linters_by_ft = {
      javascript = { 'eslint_d' },
      typescript = { 'eslint_d' },
      javascriptreact = { 'eslint_d' },
      typescriptreact = { 'eslint_d' },
      elixir = { 'credo' },
      go = { 'golangcilint' },
    }

    -- fix eslint_d warning when no config file presents
    -- ref: https://github.com/mfussenegger/nvim-lint/issues/462
    lint.linters.eslint_d = util.wrap(lint.linters.eslint_d, function(diagnostic)
      -- try to ignore "No ESLint configuration found" error
      -- if diagnostic.message:find("Error: No ESLint configuration found") then -- old version
      -- update: 20240814, following is working
      ---@diagnostic disable-next-line: return-type-mismatch
      if diagnostic.message:find 'Error: Could not find config file' then return nil end

      return diagnostic
    end)

    require 'plugins.lsp.linter.nvim-lint.autocmds'
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',

  -- Spec Versioning
  commit = 'ec9fda1', -- FIXME: golangci-lint somehow does not work after this commit
}
