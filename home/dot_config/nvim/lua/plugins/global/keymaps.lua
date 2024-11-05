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
vim.keymap.set({ 'n', 'x' }, 'H', 'zH', { desc = 'Scroll: Half Page Left' })
vim.keymap.set({ 'n', 'x' }, 'L', 'zL', { desc = 'Scroll: Half Page Right' })
vim.keymap.set({ 'n', 'x' }, '<M-h>', 'zh', { desc = 'Scroll: Left' })
vim.keymap.set({ 'n', 'x' }, '<M-l>', 'zl', { desc = 'Scroll: Right' })

-- Vertical Scrolling
vim.keymap.set({ 'n', 'x' }, '<C-Down>', '<PageDown>M', { desc = 'Scroll: Full Page Down' })
vim.keymap.set({ 'n', 'x' }, '<C-Up>', '<PageUp>M', { desc = 'Scroll: Full Page Up' })
vim.keymap.set({ 'n', 'x' }, '<S-Down>', '<C-d>zz', { desc = 'Scroll: Half Page Down' })
vim.keymap.set({ 'n', 'x' }, '<S-Up>', '<C-u>zz', { desc = 'Scroll: Half Page Up' })
vim.keymap.set({ 'n', 'x' }, '<Down>', 'jzz', { desc = 'Scroll: Down' })
vim.keymap.set({ 'n', 'x' }, '<Up>', 'kzz', { desc = 'Scroll: Up' })

-- Exit terminal mode in the builtin terminal (default: <C-\><C-n>)
-- NOTE: This won't work in all terminal emulators/tmux/etc. Try your own mapping
vim.keymap.set('t', '<C-S-\\>', '<C-\\><C-n>', { desc = 'Exit terminal mode' })

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

-- Quick access to lua commands for debugging purpose
vim.keymap.set('n', '=', ':=', { desc = 'Print Lua Expression' })

-- Quick access for running external programs
vim.keymap.set('n', '!', ':!', { desc = 'Run External Program' })

-- Substitute line while on insert mode (useful for inserting indentation on an empty line)
vim.keymap.set('i', '<M-s>', '<C-o>S', { desc = 'Substitute: Replace Line' })

-- Find and Replace (Substitution)
vim.keymap.set('n', '<leader>s', ':%s;', { desc = 'Substitute: Whole File' })
vim.keymap.set('n', '<leader>S', ':%s;\\v', { desc = 'Substitute: Whole File Regex' })
vim.keymap.set('x', 'gR', '"hy:%s;<C-r>h;&', { desc = 'Substitute: Whole File Selection' })
vim.keymap.set('x', '<leader>s', ':s;\\%V', { desc = 'Substitute: Inside Visual' })
vim.keymap.set('x', '<leader>S', ':s;\\%V\\v', { desc = 'Substitute: Inside Visual Regex' })

-- Insert/Remove indentation with ease
vim.keymap.set('i', '<M-S-,>', '<C-d>', { desc = 'Indent: Current Line Remove One' })
vim.keymap.set('i', '<M-S-.>', '<C-t>', { desc = 'Indent: Current Line Insert One' })
vim.keymap.set('n', '<M-S-,>', '<<', { desc = 'Indent: Current Line Remove One' })
vim.keymap.set('n', '<M-S-.>', '>>', { desc = 'Indent: Current Line Insert One' })
vim.keymap.set('x', '<M-S-,>', '<gv', { desc = 'Indent: Highlighted Remove One' })
vim.keymap.set('x', '<M-S-.>', '>gv', { desc = 'Indent: Highlighted Insert One' })

-- Make Increment/Decrement key more intuitive
vim.keymap.set({ 'n', 'x' }, '-', '<C-x>', { desc = 'Number: Decrement 1' })
vim.keymap.set({ 'n', 'x' }, '+', '<C-a>', { desc = 'Number: Increment 1' })
vim.keymap.set('x', 'g-', 'g<C-x>', { desc = 'Number: Decrement Sequence' })
vim.keymap.set('x', 'g+', 'g<C-a>', { desc = 'Number: Increment Sequence' })

-- Remap macro keys to prevent accidentally pressing of q's
vim.keymap.set('n', '<leader>q', macro_start_stop, { desc = 'Macro: Start/Stop Recording', expr = true })
vim.keymap.set('n', '<leader>Q', 'Q', { desc = 'Macro: Replay Last Recording' })

-- Buffer Management
vim.keymap.set('n', '<leader>W', '<cmd>silent w<CR>', { desc = 'Buffer: Write Current' })
vim.keymap.set('n', 'q', smart_delete_buffer(), { desc = 'Buffer: Delete Current' })
vim.keymap.set('n', 'Q', smart_delete_buffer(true), { desc = 'Buffer: Force Delete Current' })

-- Quickfix/Location List Navigation
vim.keymap.set('n', '<M-q>', '<cmd>botright copen<CR>', { desc = 'Quickfix List: Open / Focus' })
vim.keymap.set('n', '<M-S-q>', '<cmd>cclose<CR>', { desc = 'Quickfix List: Close' })
vim.keymap.set('n', '<M-w>', '<cmd>lopen<CR>', { desc = 'Location List: Open / Focus' })
vim.keymap.set('n', '<M-S-w>', '<cmd>lclose<CR>', { desc = 'Location List: Close' })

-- Window Navigation
vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Window: Focus Left' })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Window: Focus Right' })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Window: Focus Lower' })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Window: Focus Upper' })
vim.keymap.set('n', '<Tab>', smart_switch_window, { desc = 'Window: Focus Previously Active' })

-- `<C-w>w` doesn't work when there's more than 2 windows in a tab
-- ref: https://www.reddit.com/r/neovim/comments/pibo9c/how_to_focus_an_opened_floating_window
vim.keymap.set('n', '<C-S-k>', '999<C-w>w', { desc = 'Window: Focus Floating' })

-- Create new empty window
vim.keymap.set('n', '<C-w>n', '<cmd>vnew<CR>', { desc = 'Window: Split Empty Vertically' })
vim.keymap.set('n', '<C-w><C-n>', '<cmd>vnew<CR>', { desc = 'Window: Split Empty Vertically' })
vim.keymap.set('n', '<C-w>N', '<cmd>new<CR>', { desc = 'Window: Split Empty Horizontally' })

-- Tabpage Manipulation
vim.keymap.set('n', '<C-S-left>', '<cmd>-tabmove<CR>', { desc = 'Tab: Move Backward' })
vim.keymap.set('n', '<C-S-right>', '<cmd>+tabmove<CR>', { desc = 'Tab: Move Forward' })
vim.keymap.set('n', '<C-t>n', '<cmd>tabnew<CR>', { desc = 'Tab: Create Empty' })
vim.keymap.set('n', '<C-t><C-n>', '<cmd>tabnew<CR>', { desc = 'Tab: Create Empty' })
vim.keymap.set('n', '<C-t>o', '<cmd>tabonly<CR>', { desc = 'Tab: Close All Others' })
vim.keymap.set('n', '<C-t><C-o>', '<cmd>tabonly<CR>', { desc = 'Tab: Close All Others' })
vim.keymap.set('n', '<C-t>q', smart_close_tabpage, { desc = 'Tab: Close Current' })
vim.keymap.set('n', '<C-t><C-q>', smart_close_tabpage, { desc = 'Tab: Close Current' })

-- Tabpage Navigation
vim.keymap.set({ 'i', 'n', 'x' }, '<C-Left>', '<cmd>tabprevious<CR>', { desc = 'Tab: Go to Previous' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-Right>', '<cmd>tabnext<CR>', { desc = 'Tab: Go to Next' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-1>', '<cmd>1tabnext<CR>', { desc = 'Tab: Jump to #1' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-2>', '<cmd>2tabnext<CR>', { desc = 'Tab: Jump to #2' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-3>', '<cmd>3tabnext<CR>', { desc = 'Tab: Jump to #3' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-4>', '<cmd>4tabnext<CR>', { desc = 'Tab: Jump to #4' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-5>', '<cmd>5tabnext<CR>', { desc = 'Tab: Jump to #5' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-6>', '<cmd>6tabnext<CR>', { desc = 'Tab: Jump to #6' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-7>', '<cmd>7tabnext<CR>', { desc = 'Tab: Jump to #7' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-8>', '<cmd>8tabnext<CR>', { desc = 'Tab: Jump to #8' })
vim.keymap.set({ 'i', 'n', 'x' }, '<C-9>', '<cmd>9tabnext<CR>', { desc = 'Tab: Jump to #9' })

-- Exit NeoVim
vim.keymap.set('n', '<C-q>', '<cmd>qall<CR>', { desc = 'Quit: Soft' })
vim.keymap.set('n', '<C-S-q>', '<cmd>qall!<CR>', { desc = 'Quit: Force' })

-- Open Lazy popup window
vim.keymap.set('n', '<C-S-x>', '<cmd>Lazy<CR>', { desc = 'Lazy: Open Popup' })
