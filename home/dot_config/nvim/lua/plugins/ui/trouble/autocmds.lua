local utils = require 'plugins.ui.trouble.utils'

-- Automatically Open Trouble Quickfix
-- ref: https://github.com/folke/trouble.nvim/blob/main/docs/examples.md#automatically-open-trouble-quickfix
vim.api.nvim_create_autocmd('QuickFixCmdPost', {
  desc = 'Automatically Open Trouble Quickfix',
  group = vim.api.nvim_create_augroup('trouble-qflist-postcmd', { clear = true }),
  callback = function()
    vim.schedule(utils.handle_quickfix_open)
  end,
})

-- Open Trouble Quickfix when the qf list opens
-- ref: https://github.com/folke/trouble.nvim/blob/main/docs/examples.md#open-trouble-quickfix-when-the-qf-list-opens
-- vim.api.nvim_create_autocmd('BufRead', {
--   desc = 'Open Trouble Quickfix when the quickfix list opens',
--   group = vim.api.nvim_create_augroup('trouble-qflist-trigger', { clear = true }),
--   callback = function(ev)
--     if vim.bo[ev.buf].buftype == 'quickfix' then vim.schedule(utils.handle_quickfix_open) end
--   end,
-- })
