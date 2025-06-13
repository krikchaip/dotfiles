local map = vim.keymap.set

map("i", "jk", "<Esc>")
map({ "n", "x" }, ";", ":")

-- emacs style movement keys
map({ "i", "c" }, "<C-a>", "<Home>", { desc = "Cursor: Beginning of Line" })
map({ "i", "c" }, "<C-e>", "<End>", { desc = "Cursor: End of Line" })
map({ "i", "c" }, "<C-b>", "<Left>", { desc = "Cursor: Move Left" })
map({ "i", "c" }, "<C-f>", "<Right>", { desc = "Cursor: Move Right" })
map({ "i", "c" }, "<C-d>", "<Down>", { desc = "Cursor: Move Down" })
map({ "i", "c" }, "<C-u>", "<Up>", { desc = "Cursor: Move Up" })
map({ "i", "c", "n" }, "<M-Left>", "<S-Left>", { desc = "Cursor: Next Word" })
map({ "i", "c", "n" }, "<M-Right>", "<S-Right>", { desc = "Cursor: Previous Word" })

-- horizontal scrolling
map({ "n", "x" }, "H", "zH", { desc = "Scroll: Half Page Left" })
map({ "n", "x" }, "L", "zL", { desc = "Scroll: Half Page Right" })
map({ "n", "x" }, "<M-h>", "zh", { desc = "Scroll: Left" })
map({ "n", "x" }, "<M-l>", "zl", { desc = "Scroll: Right" })

-- vertical scrolling
map({ "n", "x" }, "<C-Down>", "<PageDown>M", { desc = "Scroll: Full Page Down" })
map({ "n", "x" }, "<C-Up>", "<PageUp>M", { desc = "Scroll: Full Page Up" })
map({ "n", "x" }, "<S-Down>", "<C-d>zz", { desc = "Scroll: Half Page Down" })
map({ "n", "x" }, "<S-Up>", "<C-u>zz", { desc = "Scroll: Half Page Up" })
map({ "n", "x" }, "<Down>", "jzz", { desc = "Scroll: Down" })
map({ "n", "x" }, "<Up>", "kzz", { desc = "Scroll: Up" })

-- highlight search terms without moving the cursor
-- ref: https://superuser.com/questions/255024/highlighting-a-search-term-without-moving-the-cursor
local highlight_inplace_n = '<cmd>let @/ = EscapeVimRegexp(expand("<cword>")) | set hls<CR>'
local highlight_inplace_x = '"hygv<cmd>let @/ = EscapeVimRegexp(@h) | let @h = @_ | set hls<CR>'

map("n", "g*", highlight_inplace_n, { desc = "Highlight: Current Word in Place" })
map("x", "g*", highlight_inplace_x, { desc = "Highlight: Selection in Place" })
map("n", "g#", highlight_inplace_n, { desc = "Highlight: Current Word in Place" })
map("x", "g#", highlight_inplace_x, { desc = "Highlight: Selection in Place" })

-- clear search highlights
map("n", "<Esc>", "<cmd>nohlsearch<CR>")

-- do not move the cursor after yanking
-- ref: https://stackoverflow.com/questions/3806629/yank-a-region-in-vim-without-the-cursor-moving-to-the-top-of-the-block
map("x", "y", "ygv<Esc>")

-- start visual highlighting from the insert mode
map("i", "<S-Left>", "<Esc>v")
map("i", "<S-Right>", "<Esc><Right>v")
map("i", "<S-Up>", "<Esc>v<Up>")
map("i", "<S-Down>", "<Esc><Right>v<Down>")

-- substitute line while in insert mode
map("i", "<M-s>", "<C-o>S", { desc = "Substitute: Replace Line" })

-- find and replace (substitution)
map("n", "<leader>s", ":%s;", { desc = "Substitute: Whole File" })
map("n", "<leader>S", ":%s;\\v", { desc = "Substitute: Whole File Regex" })
map("x", "gR", '"hy:%s;<C-r>h;&', { desc = "Substitute: Whole File Selection" })
map("x", "<leader>s", ":s;\\%V", { desc = "Substitute: Inside Visual" })
map("x", "<leader>S", ":s;\\%V\\v", { desc = "Substitute: Inside Visual Regex" })

-- insert/remove indentation
map("i", "<M-,>", "<C-d>", { desc = "Indent: Current Line Remove One" })
map("i", "<M-.>", "<C-t>", { desc = "Indent: Current Line Insert One" })
map("n", "<M-,>", "<<", { desc = "Indent: Current Line Remove One" })
map("n", "<M-.>", ">>", { desc = "Indent: Current Line Insert One" })
map("x", "<M-,>", "<gv", { desc = "Indent: Highlighted Remove One" })
map("x", "<M-.>", ">gv", { desc = "Indent: Highlighted Insert One" })

-- increment/decrement value
map({ "n", "x" }, "-", "<C-x>", { desc = "Number: Decrement 1" })
map({ "n", "x" }, "+", "<C-a>", { desc = "Number: Increment 1" })
map("x", "g-", "g<C-x>", { desc = "Number: Decrement Sequence" })
map("x", "g+", "g<C-a>", { desc = "Number: Increment Sequence" })

-- remap macro recording keys
map("n", "<leader>q", MacroStartStop, { desc = "Macro: Start/Stop Recording", expr = true })
map("n", "<leader>Q", "Q", { desc = "Macro: Replay Last Recording" })

-- buffer management (tabufline)
map("n", "<C-n>", "<cmd>enew<CR>", { desc = "Buffer: New Empty" })
map("n", "<C-s>", "<cmd>w<CR>", { desc = "Buffer: Save" })
map("n", "<C-S-s>", "<cmd>silent w<CR>", { desc = "Buffer: Save Without Formatting" })
map("n", "<C-S-c>", "<cmd>%y+<CR>", { desc = "Buffer: Copy File Content" })
map("n", ">", Tabufline.Next, { desc = "Buffer: Goto Next" })
map("n", "<", Tabufline.Prev, { desc = "Buffer: Goto Previous" })
map("n", "<M-S-.>", Tabufline.MoveRight, { desc = "Buffer: Move Right" })
map("n", "<M-S-,>", Tabufline.MoveLeft, { desc = "Buffer: Move Left" })
map("n", "q", Tabufline.Close, { desc = "Buffer: Close Current" })
map("n", "Q", Tabufline.CloseAll, { desc = "Buffer: Close All" })

for i = 1, 9, 1 do
  local key = string.format("<M-%s>", i)
  local desc = string.format("Buffer: Goto #%s", i)

  vim.keymap.set("n", key, function()
    vim.api.nvim_set_current_buf(vim.t.bufs[i])
  end, { desc = desc })
end

-- exit terminal mode
map("t", "<C-x>", "<C-\\><C-n>", { desc = "Terminal: Exit terminal mode" })
