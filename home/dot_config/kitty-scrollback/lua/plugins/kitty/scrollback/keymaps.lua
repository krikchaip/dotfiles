-- Remap exit keys
vim.keymap.set('n', 'q', '<Plug>(KsbCloseOrQuitAll)', { desc = 'Scrollback: Soft Quit' })
vim.keymap.set({ 'n', 'i', 't' }, '<C-q>', '<Plug>(KsbQuitAll)', { desc = 'Scrollback: Hard Quit' })
