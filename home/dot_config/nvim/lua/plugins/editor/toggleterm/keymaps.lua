local integration = require 'plugins.editor.toggleterm.integration'

local lazygit = integration.lazygit()

vim.keymap.set('n', '<C-g>', function()
  lazygit.default:toggle()
end, { desc = 'Git: Toggle Lazygit 💤' })

vim.keymap.set('n', '<leader>gb', function()
  lazygit.branch:toggle()
end, { desc = 'Git: Manage Branches' })
