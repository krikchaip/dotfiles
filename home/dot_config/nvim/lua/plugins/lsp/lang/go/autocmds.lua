vim.api.nvim_create_autocmd('FileType', {
  desc = 'Golang-specific buffer configurations',
  group = vim.api.nvim_create_augroup('lsp-lang-go', { clear = true }),
  pattern = { 'go' },
  callback = function(opts)
    -- NOTE: use `opts.buf` for buffer specific options
  end,
})
