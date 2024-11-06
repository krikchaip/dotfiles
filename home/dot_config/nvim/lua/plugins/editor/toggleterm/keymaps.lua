local integration = require 'plugins.editor.toggleterm.integration'

local lazygit = integration.lazygit()

vim.keymap.set('n', '<C-g>', function()
  lazygit.default:toggle()
end, { desc = 'Git: Toggle Lazygit 💤' })

vim.keymap.set('n', '<leader>gb', function()
  lazygit.branch:toggle()
end, { desc = 'Git: Manage Branches' })

vim.keymap.set('n', '<leader>gl', function()
  lazygit.log:toggle()
end, { desc = 'Git: Show Logs' })

vim.keymap.set('n', '<leader>gf', function()
  local path = vim.api.nvim_buf_get_name(0)

  lazygit.file_history.cmd = table.concat({ 'lazygit', '-f', path }, ' ')
  lazygit.file_history:toggle()
end, { desc = 'Git: Current File History' })
