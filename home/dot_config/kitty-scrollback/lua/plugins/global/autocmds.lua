-- Highlight when yanking (copying) text
-- ref: https://github.com/nvim-lua/kickstart.nvim/blob/master/init.lua#L196-L205
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('highlight-yank', { clear = true }),
  callback = function()
    vim.hl.on_yank()
  end,
})
