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

-- Clear search highlights on pressing <Esc> in normal mode
vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>')

-- Highlighting a search term without moving the cursor
-- ref: https://superuser.com/questions/255024/highlighting-a-search-term-without-moving-the-cursor
local highlight_inplace_n = '<cmd>let @/ = EscapeVimRegexp(expand("<cword>")) | set hls<CR>'
local highlight_inplace_x = '"hygv<cmd>let @/ = EscapeVimRegexp(@h) | let @h = @_ | set hls<CR>'

vim.keymap.set('n', 'g*', highlight_inplace_n, { desc = 'Highlight: Current Word in Place' })
vim.keymap.set('x', 'g*', highlight_inplace_x, { desc = 'Highlight: Selection in Place' })
vim.keymap.set('n', 'g#', highlight_inplace_n, { desc = 'Highlight: Current Word in Place' })
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

-- Quick access to lua commands for debugging purpose
vim.keymap.set('n', '=', ':=', { desc = 'Print Lua Expression' })

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
vim.keymap.set('n', '<leader>q', macro_start_stop, { desc = 'Macro: Start/Stop Recording', expr = true })
vim.keymap.set('n', '<leader>Q', 'Q', { desc = 'Macro: Replay Last Recording' })

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

-- Exit NeoVim
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit: Soft' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Quit: Force' })

-- Open Lazy popup window
vim.keymap.set('n', '<C-S-x>', '<cmd>Lazy<CR>', { desc = 'Lazy: Open Popup' })
