-- issue ref: https://github.com/nvim-tree/nvim-tree.lua/issues/451
-- neogit events: https://github.com/search?q=repo:NeogitOrg/neogit%20nvim_exec_autocmds&type=code
vim.api.nvim_create_autocmd('User', {
  desc = 'Reload Nvim-tree after Neogit operations (staging, commiting, etc.)',
  group = vim.api.nvim_create_augroup('nvim-tree-neogit', { clear = true }),
  pattern = {
    'NeogitBranchCheckout',
    'NeogitBranchDelete',
    'NeogitBranchReset',
    'NeogitCherryPick',
    'NeogitMerge',
    'NeogitPullComplete',
    'NeogitPushComplete',
    'NeogitRebase',
    'NeogitReset',
    'NeogitStash',
    'NeogitStatusRefreshed',
  },
  callback = function()
    require('nvim-tree.api').tree.reload()
  end,
})

vim.api.nvim_create_autocmd('TabEnter', {
  desc = 'Reload Nvim-tree after entering a tab page',
  group = vim.api.nvim_create_augroup('nvim-tree-tabpage', { clear = true }),
  callback = function()
    require('nvim-tree.api').tree.reload()
  end,
})

vim.api.nvim_create_autocmd('BufEnter', {
  desc = 'Auto reveal current buffer in Nvim-tree',
  group = vim.api.nvim_create_augroup('nvim-tree-autoreveal', { clear = true }),
  callback = function()
    if not vim.g.nvim_tree_autoreveal then return end

    local api = require 'nvim-tree.api'
    api.tree.find_file()
  end,
})
