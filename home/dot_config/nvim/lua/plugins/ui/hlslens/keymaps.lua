local opts = { noremap = true, silent = true }

opts.desc = 'Jump to the next match'
vim.keymap.set('n', 'n', [[<Cmd>execute('normal! ' . v:count1 . 'n')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

opts.desc = 'Jump to the previous match'
vim.keymap.set('n', 'N', [[<Cmd>execute('normal! ' . v:count1 . 'N')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

opts.desc = 'Jump to the next match under cursor'
vim.keymap.set('n', '*', [[*<Cmd>lua require('hlslens').start()<CR>]], opts)

opts.desc = 'Jump to the previous match under cursor'
vim.keymap.set('n', '#', [[#<Cmd>lua require('hlslens').start()<CR>]], opts)
