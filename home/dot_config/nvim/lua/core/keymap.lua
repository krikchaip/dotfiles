-- Emacs style movement keys for insert/command mode
vim.keymap.set({ 'i', 'c' }, '<C-f>', '<Right>')
vim.keymap.set({ 'i', 'c' }, '<C-b>', '<Left>')
vim.keymap.set({ 'i', 'c' }, '<C-d>', '<Down>')
vim.keymap.set({ 'i', 'c' }, '<C-u>', '<Up>')
vim.keymap.set({ 'i', 'c' }, '<C-a>', '<Home>')
vim.keymap.set({ 'i', 'c' }, '<C-e>', '<End>')

-- Horizontal Scrolling
vim.keymap.set('n', '<M-h>', 'zH', { desc = 'Scroll half page left' })
vim.keymap.set('n', '<M-l>', 'zL', { desc = 'Scroll half page right' })
vim.keymap.set('n', '<M-S-h>', 'zh', { desc = 'Scroll left' })
vim.keymap.set('n', '<M-S-l>', 'zl', { desc = 'Scroll right' })

-- Vertical Scrolling
vim.keymap.set('n', '<C-d>', '<C-d>zz', { desc = 'Scroll half page down' })
vim.keymap.set('n', '<C-u>', '<C-u>zz', { desc = 'Scroll half page up' })
vim.keymap.set('n', '<M-j>', 'jzz', { desc = 'Scroll down' })
vim.keymap.set('n', '<M-k>', 'kzz', { desc = 'Scroll up' })

-- Exit terminal mode in the builtin terminal (default: <C-\><C-n>)
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
-- vim.keymap.set('t', '<Esc><Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })

-- Clear search highlights on pressing <Esc> in normal mode
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Fix visual mode yank region cursor moving back to the top
-- ref: https://stackoverflow.com/questions/3806629/yank-a-region-in-vim-without-the-cursor-moving-to-the-top-of-the-block
vim.keymap.set('x', 'y', 'ygv<Esc>')

-- Simple autoclose in command mode
vim.keymap.set('c', '{', '{}<Left>')
vim.keymap.set('c', '[', '[]<Left>')
vim.keymap.set('c', '(', '()<Left>')
vim.keymap.set('c', "'", "''<Left>")
vim.keymap.set('c', '"', '""<Left>')

-- Substitute line while on insert mode (useful for inserting indentation on an empty line)
vim.keymap.set('i', '<C-s>', '<C-o>S')

-- Insert/Remove indentation with ease
vim.keymap.set('i', '<M-S-,>', '<C-d>', { desc = 'Remove one indent from this line' })
vim.keymap.set('i', '<M-S-.>', '<C-t>', { desc = 'Insert one indent to this line' })
vim.keymap.set('x', '<M-S-,>', '<gv', { desc = 'Remove one indent from this region' })
vim.keymap.set('x', '<M-S-.>', '>gv', { desc = 'Insert one indent to this region' })
vim.keymap.set('n', '<M-S-,>', '<<', { desc = 'Remove one indent from this line' })
vim.keymap.set('n', '<M-S-.>', '>>', { desc = 'Insert one indent to this line' })

-- Make Increment/Decrement key more intuitive
vim.keymap.set('n', '-', '<C-x>', { desc = 'Decrement number' })
vim.keymap.set('n', '+', '<C-a>', { desc = 'Increment number' })

-- Saving buffers (files)
vim.keymap.set('n', '<leader>w', '<cmd>w<CR>', { desc = 'Write current buffer' })

-- Delete current buffer
vim.keymap.set('n', '<leader>q', function()
  if #vim.api.nvim_tabpage_list_wins(0) > 1 then
    vim.cmd [[bdelete | wincmd p]]
  else
    vim.cmd [[bdelete | silent tabprevious]]
  end
end, { desc = 'Delete current buffer' })

vim.keymap.set('n', '<leader><S-q>', function()
  if #vim.api.nvim_tabpage_list_wins(0) > 1 then
    vim.cmd [[bdelete! | wincmd p]]
  else
    vim.cmd [[bdelete! | silent tabprevious]]
  end
end, { desc = 'Force delete current buffer' })

-- Window Navigation
vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Move focus to the left window' })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Move focus to the right window' })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Move focus to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Move focus to the upper window' })
vim.keymap.set('n', '<Tab>', '<C-w>p', { desc = 'Move focus to the previously active window' })

-- `<C-w>w` doesn't work when there's more than 2 windows in a tab
-- ref: https://www.reddit.com/r/neovim/comments/pibo9c/how_to_focus_an_opened_floating_window
vim.keymap.set('n', '<C-S-k>', '999<C-w>w', { desc = 'Move focus to the floating window' })

-- Create a new empty window/tab
vim.keymap.set('n', '<C-w>n', '<cmd>vnew<CR>', { desc = 'Split a new empty window vertically' })
vim.keymap.set('n', '<C-w>N', '<cmd>new<CR>', { desc = 'Split a new empty window horizontally' })
vim.keymap.set('n', '<C-n>', '<cmd>tabnew<CR>', { desc = 'Create a new empty tab' })

-- Tabpage Manipulation
vim.keymap.set('n', '<C-S-left>', '<cmd>-tabmove<CR>', { desc = 'Move the current tab backward' })
vim.keymap.set('n', '<C-S-right>', '<cmd>+tabmove<CR>', { desc = 'Move the current tab forward' })
vim.keymap.set('n', '<leader>tq', '<cmd>tabclose<CR>', { desc = 'Close the current tab' })
vim.keymap.set('n', '<leader>to', '<cmd>tabonly<CR>', { desc = 'Close all other tab pages' })

-- Tabpage Navigation
vim.keymap.set('n', '<C-Left>', '<cmd>tabprevious<CR>', { desc = 'Go to previous tab' })
vim.keymap.set('n', '<C-Right>', '<cmd>tabnext<CR>', { desc = 'Go to next tab' })
vim.keymap.set('n', '<leader>1', '<cmd>1tabnext<CR>', { desc = 'Go to tab #1' })
vim.keymap.set('n', '<leader>2', '<cmd>2tabnext<CR>', { desc = 'Go to tab #2' })
vim.keymap.set('n', '<leader>3', '<cmd>3tabnext<CR>', { desc = 'Go to tab #3' })
vim.keymap.set('n', '<leader>4', '<cmd>4tabnext<CR>', { desc = 'Go to tab #4' })
vim.keymap.set('n', '<leader>5', '<cmd>5tabnext<CR>', { desc = 'Go to tab #5' })
vim.keymap.set('n', '<leader>6', '<cmd>6tabnext<CR>', { desc = 'Go to tab #6' })
vim.keymap.set('n', '<leader>7', '<cmd>7tabnext<CR>', { desc = 'Go to tab #7' })
vim.keymap.set('n', '<leader>8', '<cmd>8tabnext<CR>', { desc = 'Go to tab #8' })
vim.keymap.set('n', '<leader>9', '<cmd>9tabnext<CR>', { desc = 'Go to tab #9' })

-- Exit NeoVim
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit all buffers (soft quit NeoVim)' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Force quit NeoVim' })
