vim.api.nvim_create_autocmd('FileType', {
  desc = 'Golang-specific buffer configurations',
  group = vim.api.nvim_create_augroup('lsp-lang-go', { clear = true }),
  pattern = { 'go' },
  callback = function(_)
    -- NOTE: use `opts.buf` for buffer specific options
  end,
})

vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  desc = 'Go template syntax highlighting',
  group = vim.api.nvim_create_augroup('lsp-lang-go-template', { clear = true }),
  pattern = { '*.tmpl.*', '*.tmpl' },
  callback = function()
    vim.cmd [[set syntax=gotmpl]]
  end,
})
