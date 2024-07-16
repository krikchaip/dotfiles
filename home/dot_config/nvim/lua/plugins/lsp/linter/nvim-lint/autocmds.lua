vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
  desc = 'Trigger linters',
  group = vim.api.nvim_create_augroup('nvim-lint-try-lint', { clear = true }),
  callback = function()
    require('lint').try_lint()
  end,
})
