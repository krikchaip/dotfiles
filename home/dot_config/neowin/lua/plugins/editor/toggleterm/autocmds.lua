vim.api.nvim_create_autocmd('TermOpen', {
  desc = 'Assign keybindings for toggleterm terminals',
  group = vim.api.nvim_create_augroup('toggleterm-termopen', { clear = true }),
  pattern = 'term://*toggleterm#*',
  callback = function()
    -- Terminal window mappings
    -- ref: https://github.com/akinsho/toggleterm.nvim#terminal-window-mappings
  end,
})
