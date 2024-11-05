local integration = require 'plugins.editor.toggleterm.integration'

local lazygit = integration.lazygit()

vim.keymap.set('n', '<C-g>', function()
  lazygit.default:toggle()
end, { desc = 'Lazygit: Toggle Source Control' })
