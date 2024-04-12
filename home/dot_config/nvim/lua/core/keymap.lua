-- [[ Basic Keymaps ]]
-- See `:help vim.keymap.set()`

-- Clear search highlights on pressing <Esc> in normal mode
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Diagnostic keymaps
-- vim.keymap.set('n', '[d', vim.diagnostic.goto_prev, { desc = 'Go to previous [d]iagnostic message' })
-- vim.keymap.set('n', ']d', vim.diagnostic.goto_next, { desc = 'Go to next [d]iagnostic message' })
-- vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic [e]rror messages' })
-- vim.keymap.set('n', '<leader>q', vim.diagnostic.setloclist, { desc = 'Open diagnostic [q]uickfix list' })

-- Exit terminal mode in the builtin terminal with a shortcut that is a bit easier
-- for people to discover. Otherwise, you normally need to press <C-\><C-n>, which
-- is not what someone will guess without a bit more experience.
--
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
-- or just use <C-\><C-n> to exit terminal mode
-- vim.keymap.set('t', '<Esc><Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })

-- TIP: Disable arrow keys in normal mode
-- vim.keymap.set('n', '<left>', '<cmd>echo "Use h to move!!"<CR>')
-- vim.keymap.set('n', '<right>', '<cmd>echo "Use l to move!!"<CR>')
-- vim.keymap.set('n', '<up>', '<cmd>echo "Use k to move!!"<CR>')
-- vim.keymap.set('n', '<down>', '<cmd>echo "Use j to move!!"<CR>')

-- Keybinds to make split navigation easier.
-- Use CTRL+<hjkl> to switch between windows
--
-- See `:help wincmd` for a list of all window commands
vim.keymap.set('n', '<C-h>', '<C-w><C-h>', { desc = 'Move focus to the left window' })
vim.keymap.set('n', '<C-l>', '<C-w><C-l>', { desc = 'Move focus to the right window' })
vim.keymap.set('n', '<C-j>', '<C-w><C-j>', { desc = 'Move focus to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w><C-k>', { desc = 'Move focus to the upper window' })

-- Saving buffers (files)
vim.keymap.set('n', '<leader>w', '<cmd>w<CR>', { desc = 'Write current buffer (save file)' })
vim.keymap.set('i', '<C-s>', '<cmd>w<CR>', { desc = 'Write current buffer (save file)' })
vim.keymap.set('n', '<leader><S-w>', '<cmd>wall<CR>', { desc = 'Write all changed buffers (save all files)' })

-- Delete current buffer
-- See `:help bdelete`
vim.keymap.set('n', '<leader>q', '<cmd>bdelete<CR>', { desc = 'Delete current buffer' })
vim.keymap.set('n', '<leader><S-q>', '<cmd>bdelete!<CR>', { desc = 'Force delete current buffer' })

-- Exit NeoVim
-- See `:help :exit`
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit all buffers (soft quit NeoVim)' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Force quit NeoVim' })

-- Tab Navigation
-- See `:help tab-page`
vim.keymap.set('n', '<C-n>', '<cmd>tabnew<CR>', { desc = 'Create a new empty tab' })
vim.keymap.set('n', '<leader>tq', '<cmd>tabclose<CR>', { desc = 'Close the current tab' })
vim.keymap.set('n', '<leader>tb', '<cmd>-tabmove<CR>', { desc = 'Move the current tab [b]ackward' })
vim.keymap.set('n', '<leader>tf', '<cmd>+tabmove<CR>', { desc = 'Move the current tab [f]orward' })
vim.keymap.set('n', '<C-1>', '<cmd>1tabnext<CR>', { desc = 'Go to tab #1' })
vim.keymap.set('n', '<C-2>', '<cmd>2tabnext<CR>', { desc = 'Go to tab #2' })
vim.keymap.set('n', '<C-3>', '<cmd>3tabnext<CR>', { desc = 'Go to tab #3' })
vim.keymap.set('n', '<C-4>', '<cmd>4tabnext<CR>', { desc = 'Go to tab #4' })
vim.keymap.set('n', '<C-5>', '<cmd>5tabnext<CR>', { desc = 'Go to tab #5' })
vim.keymap.set('n', '<C-6>', '<cmd>6tabnext<CR>', { desc = 'Go to tab #6' })
vim.keymap.set('n', '<C-7>', '<cmd>7tabnext<CR>', { desc = 'Go to tab #7' })
vim.keymap.set('n', '<C-8>', '<cmd>8tabnext<CR>', { desc = 'Go to tab #8' })
vim.keymap.set('n', '<C-9>', '<cmd>9tabnext<CR>', { desc = 'Go to tab #9' })
