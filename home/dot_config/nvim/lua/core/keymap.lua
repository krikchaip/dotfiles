-- Clear search highlights on pressing <Esc> in normal mode
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Exit terminal mode in the builtin terminal (default: <C-\><C-n>)
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
-- vim.keymap.set('t', '<Esc><Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })

-- Saving buffers (files)
vim.keymap.set('n', '<leader>w', '<cmd>w<CR>', { desc = 'Write current buffer (save file)' })
vim.keymap.set('i', '<C-s>', '<cmd>w<CR>', { desc = 'Write current buffer (save file)' })

vim.keymap.set('n', '<leader><S-w>', '<cmd>wall<CR>', { desc = 'Write all changed buffers (save all files)' })

-- Delete current buffer
vim.keymap.set('n', '<leader>q', '<cmd>bdelete<CR>', { desc = 'Delete current buffer' })
vim.keymap.set('n', '<leader><S-q>', '<cmd>bdelete!<CR>', { desc = 'Force delete current buffer' })

-- Window Navigation
vim.keymap.set('n', '<C-h>', '<C-w><C-h>', { desc = 'Move focus to the left window' })
vim.keymap.set('n', '<C-l>', '<C-w><C-l>', { desc = 'Move focus to the right window' })
vim.keymap.set('n', '<C-j>', '<C-w><C-j>', { desc = 'Move focus to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w><C-k>', { desc = 'Move focus to the upper window' })

vim.keymap.set('n', '<C-w>n', '<cmd>vnew<CR>', { desc = 'Split a new empty window vertically' })
vim.keymap.set('n', '<C-w>N', '<cmd>new<CR>', { desc = 'Split a new empty window horizontally' })

-- `<C-w>w` doesn't work when there's more than 2 windows in a tab
-- ref: https://www.reddit.com/r/neovim/comments/pibo9c/how_to_focus_an_opened_floating_window
vim.keymap.set('n', '<C-S-k>', '999<C-w>w', { desc = 'Move focus to the floating window' })

-- Tab Navigation
vim.keymap.set('n', '<C-n>', '<cmd>tabnew<CR>', { desc = 'Create a new empty tab' })
vim.keymap.set('n', '<leader>tq', '<cmd>tabclose<CR>', { desc = 'Close the current tab' })
vim.keymap.set('n', '<leader>to', '<cmd>tabonly<CR>', { desc = 'Close all other tab pages' })

vim.keymap.set('n', '<C-S-left>', '<cmd>-tabmove<CR>', { desc = 'Move the current tab backward' })
vim.keymap.set('n', '<C-S-right>', '<cmd>+tabmove<CR>', { desc = 'Move the current tab forward' })

vim.keymap.set('n', '<C-left>', '<cmd>tabprevious<CR>', { desc = 'Go to previous tab' })
vim.keymap.set('n', '<C-right>', '<cmd>tabnext<CR>', { desc = 'Go to next tab' })

vim.keymap.set('n', '<C-1>', '<cmd>1tabnext<CR>', { desc = 'Go to tab #1' })
vim.keymap.set('n', '<C-2>', '<cmd>2tabnext<CR>', { desc = 'Go to tab #2' })
vim.keymap.set('n', '<C-3>', '<cmd>3tabnext<CR>', { desc = 'Go to tab #3' })
vim.keymap.set('n', '<C-4>', '<cmd>4tabnext<CR>', { desc = 'Go to tab #4' })
vim.keymap.set('n', '<C-5>', '<cmd>5tabnext<CR>', { desc = 'Go to tab #5' })
vim.keymap.set('n', '<C-6>', '<cmd>6tabnext<CR>', { desc = 'Go to tab #6' })
vim.keymap.set('n', '<C-7>', '<cmd>7tabnext<CR>', { desc = 'Go to tab #7' })
vim.keymap.set('n', '<C-8>', '<cmd>8tabnext<CR>', { desc = 'Go to tab #8' })
vim.keymap.set('n', '<C-9>', '<cmd>9tabnext<CR>', { desc = 'Go to tab #9' })

-- Exit NeoVim
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit all buffers (soft quit NeoVim)' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Force quit NeoVim' })
