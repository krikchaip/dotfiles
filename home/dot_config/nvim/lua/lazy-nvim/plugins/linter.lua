return {
  {
    'mfussenegger/nvim-lint',
    name = 'lint',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local lint = require 'lint'

      lint.linters_by_ft = {
        javascript = { 'eslint_d' },
        typescript = { 'eslint_d' },
        javascriptreact = { 'eslint_d' },
        typescriptreact = { 'eslint_d' },
        elixir = { 'credo' },
      }

      vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
        desc = 'Trigger linters',
        group = vim.api.nvim_create_augroup('nvim-lint-try-lint', { clear = true }),
        callback = function() lint.try_lint() end,
      })
    end,
  },
}
