---@diagnostic disable: param-type-mismatch

-- Emacs style movement keys
vim.keymap.set({ 'i', 'c' }, '<C-f>', '<Right>')
vim.keymap.set({ 'i', 'c' }, '<C-b>', '<Left>')
vim.keymap.set({ 'i', 'c' }, '<C-d>', '<Down>')
vim.keymap.set({ 'i', 'c' }, '<C-u>', '<Up>')
vim.keymap.set({ 'i', 'c' }, '<C-a>', '<Home>')
vim.keymap.set({ 'i', 'c' }, '<C-e>', '<End>')
vim.keymap.set({ 'i', 'c', 'n' }, '<M-Left>', '<S-Left>')
vim.keymap.set({ 'i', 'c', 'n' }, '<M-Right>', '<S-Right>')

-- Horizontal Scrolling
vim.keymap.set('n', 'H', 'zH', { desc = 'Scroll: Half Page Left' })
vim.keymap.set('n', 'L', 'zL', { desc = 'Scroll: Half Page Right' })
vim.keymap.set('n', '<M-h>', 'zh', { desc = 'Scroll: Left' })
vim.keymap.set('n', '<M-l>', 'zl', { desc = 'Scroll: Right' })

-- Vertical Scrolling
vim.keymap.set('n', '<C-Down>', '<PageDown>M', { desc = 'Scroll: Full Page Down' })
vim.keymap.set('n', '<C-Up>', '<PageUp>M', { desc = 'Scroll: Full Page Up' })
vim.keymap.set('n', '<S-Down>', '<C-d>zz', { desc = 'Scroll: Half Page Down' })
vim.keymap.set('n', '<S-Up>', '<C-u>zz', { desc = 'Scroll: Half Page Up' })
vim.keymap.set('n', '<Down>', 'jzz', { desc = 'Scroll: Down' })
vim.keymap.set('n', '<Up>', 'kzz', { desc = 'Scroll: Up' })

-- Exit terminal mode in the builtin terminal (default: <C-\><C-n>)
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
-- vim.keymap.set('t', '<Esc><Esc>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })

-- Clear search highlights on pressing <Esc> in normal mode
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Highlighting a search term without moving the cursor
-- ref: https://superuser.com/questions/255024/highlighting-a-search-term-without-moving-the-cursor
local highlight_inplace_n = '<cmd>let @/ = "\\\\<" . expand("<cword>") . "\\\\>" | set hls<CR>'
local highlight_inplace_x = '"hygv<cmd>let @/ = "\\\\<" . @h . "\\\\>" | let @h = @_ | set hls<CR>'

vim.keymap.set('n', 'g*', highlight_inplace_n, { desc = 'Highlight: Current Word in Place' })
vim.keymap.set('n', 'g#', highlight_inplace_n, { desc = 'Highlight: Current Word in Place' })
vim.keymap.set('x', 'g*', highlight_inplace_x, { desc = 'Highlight: Selection in Place' })
vim.keymap.set('x', 'g#', highlight_inplace_x, { desc = 'Highlight: Selection in Place' })

-- Fix visual mode yank region cursor moving back to the top
-- ref: https://stackoverflow.com/questions/3806629/yank-a-region-in-vim-without-the-cursor-moving-to-the-top-of-the-block
vim.keymap.set('x', 'y', 'ygv<Esc>')

-- Start visual highlighting right from the insert mode
vim.keymap.set('i', '<S-Left>', '<Esc>v')
vim.keymap.set('i', '<S-Right>', '<Esc><Right>v')
vim.keymap.set('i', '<S-Up>', '<Esc>v<Up>')
vim.keymap.set('i', '<S-Down>', '<Esc><Right>v<Down>')
vim.keymap.set('x', '<S-Up>', '<Up>')
vim.keymap.set('x', '<S-Down>', '<Down>')

-- Simple autoclose in command mode
vim.keymap.set('c', '{', '{}<Left>')
vim.keymap.set('c', '[', '[]<Left>')
vim.keymap.set('c', '(', '()<Left>')
vim.keymap.set('c', "'", "''<Left>")
vim.keymap.set('c', '"', '""<Left>')

-- Substitute line while on insert mode (useful for inserting indentation on an empty line)
vim.keymap.set('i', '<M-s>', '<C-o>S', { desc = 'Substitute line' })

-- Insert/Remove indentation with ease
vim.keymap.set('i', '<M-S-,>', '<C-d>', { desc = 'Indent: Current Line Remove One' })
vim.keymap.set('i', '<M-S-.>', '<C-t>', { desc = 'Indent: Current Line Insert One' })
vim.keymap.set('x', '<M-S-,>', '<gv', { desc = 'Indent: Highlighted Remove One' })
vim.keymap.set('x', '<M-S-.>', '>gv', { desc = 'Indent: Highlighted Insert One' })
vim.keymap.set('n', '<M-S-,>', '<<', { desc = 'Indent: Current Line Remove One' })
vim.keymap.set('n', '<M-S-.>', '>>', { desc = 'Indent: Current Line Insert One' })

-- Make Increment/Decrement key more intuitive
vim.keymap.set('n', '-', '<C-x>', { desc = 'Number: Decrement' })
vim.keymap.set('n', '+', '<C-a>', { desc = 'Number: Increment' })

-- Remap macro keys to prevent accidentally pressing of q's
vim.keymap.set('n', '<leader>m', macro_start_stop, { desc = 'Macro: Start/Stop Recording', expr = true })
vim.keymap.set('n', '<leader>M', 'Q', { desc = 'Macro: Replay Last Recording' })

-- Buffer Management
vim.keymap.set('n', '<leader>w', '<cmd>w<CR>', { desc = 'Buffer: Write Current' })
vim.keymap.set('n', 'q', smart_delete_buffer(), { desc = 'Buffer: Delete Current' })
vim.keymap.set('n', 'Q', smart_delete_buffer(true), { desc = 'Buffer: Force Delete Current' })

-- Window Navigation
vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Window: Focus Left' })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Window: Focus Right' })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Window: Focus Lower' })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Window: Focus Upper' })
vim.keymap.set('n', '<Tab>', '<C-w>p', { desc = 'Window: Focus Previously Active' })

-- `<C-w>w` doesn't work when there's more than 2 windows in a tab
-- ref: https://www.reddit.com/r/neovim/comments/pibo9c/how_to_focus_an_opened_floating_window
vim.keymap.set('n', '<C-S-k>', '999<C-w>w', { desc = 'Window: Focus Floating' })

-- Create new empty window
vim.keymap.set('n', '<C-w>n', '<cmd>vnew<CR>', { desc = 'Window: Split Empty Vertically' })
vim.keymap.set('n', '<C-w>N', '<cmd>new<CR>', { desc = 'Window: Split Empty Horizontally' })

-- Tabpage Manipulation
vim.keymap.set('n', '<C-S-left>', '<cmd>-tabmove<CR>', { desc = 'Tab: Move Backward' })
vim.keymap.set('n', '<C-S-right>', '<cmd>+tabmove<CR>', { desc = 'Tab: Move Forward' })
vim.keymap.set('n', '<leader>to', '<cmd>tabonly<CR>', { desc = 'Tab: Close All Others' })
vim.keymap.set('n', '<C-n>', '<cmd>tabnew<CR>', { desc = 'Tab: Create Empty' })
vim.keymap.set('n', '<leader>tq', smart_close_tabpage, { desc = 'Tab: Close Current' })

-- Tabpage Navigation
vim.keymap.set('n', '<C-Left>', '<cmd>tabprevious<CR>', { desc = 'Tab: Go to Previous' })
vim.keymap.set('n', '<C-Right>', '<cmd>tabnext<CR>', { desc = 'Tab: Go to Next' })
vim.keymap.set('n', '<leader>1', '<cmd>1tabnext<CR>', { desc = 'Tab: Jump to #1' })
vim.keymap.set('n', '<leader>2', '<cmd>2tabnext<CR>', { desc = 'Tab: Jump to #2' })
vim.keymap.set('n', '<leader>3', '<cmd>3tabnext<CR>', { desc = 'Tab: Jump to #3' })
vim.keymap.set('n', '<leader>4', '<cmd>4tabnext<CR>', { desc = 'Tab: Jump to #4' })
vim.keymap.set('n', '<leader>5', '<cmd>5tabnext<CR>', { desc = 'Tab: Jump to #5' })
vim.keymap.set('n', '<leader>6', '<cmd>6tabnext<CR>', { desc = 'Tab: Jump to #6' })
vim.keymap.set('n', '<leader>7', '<cmd>7tabnext<CR>', { desc = 'Tab: Jump to #7' })
vim.keymap.set('n', '<leader>8', '<cmd>8tabnext<CR>', { desc = 'Tab: Jump to #8' })
vim.keymap.set('n', '<leader>9', '<cmd>9tabnext<CR>', { desc = 'Tab: Jump to #9' })

-- Exit NeoVim
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit: Soft' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Quit: Force' })
