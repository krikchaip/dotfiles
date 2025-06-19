local map = vim.keymap.set

map("i", "jk", "<Esc>")
map({ "n", "x" }, ";", ":")

-- the most useful keymaps ever...
map("n", "<C-q>", "<cmd>qa<CR>", { desc = "Exit Neovim: Soft" })
map("n", "<C-S-q>", "<cmd>qa!<CR>", { desc = "Exit Neovim: Force" })

-- nvchad specific
map("n", "<C-/>", NvChad.Cheatsheet, { desc = "NvChad: Toggle NvCheatsheet" })
map("n", "<C-,>t", NvChad.Themes, { desc = "NvChad: Select Colorscheme" })
map("n", "<C-,><C-t>", NvChad.Themes, { desc = "NvChad: Select Colorscheme" })

-- plugin management
map("n", "<C-S-x>", "<cmd>Lazy<CR>", { desc = "Lazy: Open Popup" })
map("n", "<C-S-l>", "<cmd>Mason<CR>", { desc = "Mason: Open Popup" })

-- line number display
map("n", "<leader>lnn", "<cmd>set nu!<CR>", { desc = "Line Number: Toggle Default" })
map("n", "<leader>lnr", "<cmd>set rnu!<CR>", { desc = "Line Number: Toggle Relative" })

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

-- comment
map("n", "<M-/>", "gcc", { desc = "Comment: Toggle Line", remap = true })
map("v", "<M-/>", "gc", { desc = "Comment: Toggle Region", remap = true })

-- increment/decrement value
map({ "n", "x" }, "-", "<C-x>", { desc = "Number: Decrement 1" })
map({ "n", "x" }, "+", "<C-a>", { desc = "Number: Increment 1" })
map("x", "g-", "g<C-x>", { desc = "Number: Decrement Sequence" })
map("x", "g+", "g<C-a>", { desc = "Number: Increment Sequence" })

-- remap macro recording keys
map("n", "<leader>q", MacroStartStop, { desc = "Macro: Start/Stop Recording", expr = true })
map("n", "<leader>Q", "Q", { desc = "Macro: Replay Last Recording" })

-- buffer management
map("n", "<C-n>", "<cmd>enew<CR>", { desc = "Buffer: New Empty" })
map("n", "<leader>=", Conform.Format, { desc = "Buffer: Format Content" })
map("n", "<C-s>", Conform.FormatSave, { desc = "Buffer: Format and Save" })
map("n", "<C-S-s>", "<cmd>silent w<CR>", { desc = "Buffer: Save Without Formatting" })
map("n", "<C-S-c>", "<cmd>%y+<CR>", { desc = "Buffer: Copy File Content" })
map("n", "\\", "<C-^>", { desc = "Buffer: Goto Previously Edited" })
map("n", "<", Tabufline.Prev, { desc = "Buffer: Goto Previous" })
map("n", ">", Tabufline.Next, { desc = "Buffer: Goto Next" })
map("n", "<M-S-,>", Tabufline.MoveLeft, { desc = "Buffer: Move Left" })
map("n", "<M-S-.>", Tabufline.MoveRight, { desc = "Buffer: Move Right" })
map("n", "q", Tabufline.Close, { desc = "Buffer: Close Current" })
map("n", "Q", Tabufline.CloseAll, { desc = "Buffer: Close All" })

for i = 1, 9, 1 do
  local key = string.format("<M-%s>", i)
  local desc = string.format("Buffer: Goto #%s", i)

  vim.keymap.set("n", key, function()
    vim.api.nvim_set_current_buf(vim.t.bufs[i])
  end, { desc = desc })
end

-- window management
map("n", "<C-h>", "<C-w>h", { desc = "Window: Focus Left" })
map("n", "<C-l>", "<C-w>l", { desc = "Window: Focus Right" })
map("n", "<C-j>", "<C-w>j", { desc = "Window: Focus Lower" })
map("n", "<C-k>", "<C-w>k", { desc = "Window: Focus Upper" })
map("n", "<Tab>", "<cmd>wincmd p<CR>", { desc = "Window: Focus Previously Active" })
map("n", "<C-w>n", "<cmd>vnew<CR>", { desc = "Window: Split Empty Vertically" })
map("n", "<C-w><C-n>", "<cmd>vnew<CR>", { desc = "Window: Split Empty Vertically" })
map("n", "<C-w>N", "<cmd>new<CR>", { desc = "Window: Split Empty Horizontally" })

-- tabpage management
map("n", "<C-Left>", "<cmd>tabprevious<CR>", { desc = "Tab: Go to Previous" })
map("n", "<C-Right>", "<cmd>tabnext<CR>", { desc = "Tab: Go to Next" })
map("n", "<C-S-left>", "<cmd>-tabmove<CR>", { desc = "Tab: Move Backward" })
map("n", "<C-S-right>", "<cmd>+tabmove<CR>", { desc = "Tab: Move Forward" })
map("n", "<C-t>n", "<cmd>tabnew<CR>", { desc = "Tab: Create Empty" })
map("n", "<C-t><C-n>", "<cmd>tabnew<CR>", { desc = "Tab: Create Empty" })
map("n", "<C-t>o", "<cmd>tabonly<CR>", { desc = "Tab: Close All Others" })
map("n", "<C-t><C-o>", "<cmd>tabonly<CR>", { desc = "Tab: Close All Others" })
map("n", "<C-t>q", "<cmd>tabclose<CR>", { desc = "Tab: Close Current" })
map("n", "<C-t><C-q>", "<cmd>tabclose<CR>", { desc = "Tab: Close Current" })

for i = 1, 9, 1 do
  vim.keymap.set(
    "n",
    string.format("<C-%s>", i),
    string.format("<cmd>%stabnext<CR>", i),
    { desc = string.format("Tab: Jump to #%s", i) }
  )
end

-- builtin terminal
map("n", "<leader>tv", Term.VSplit, { desc = "Terminal: New Vertical Term" })
map("n", "<leader>tx", Term.HSplit, { desc = "Terminal: New Horizontal Term" })
map({ "n", "t" }, "<M-v>", Term.VToggle, { desc = "Terminal: Toggleable Vertical Term" })
map({ "n", "t" }, "<M-x>", Term.HToggle, { desc = "Terminal: Toggleable Horizontal Term" })
map({ "n", "t" }, "<M-t>", Term.Toggle, { desc = "Terminal: Toggle Floating Term" })

-- exit terminal mode
map("t", "<C-x>", "<C-\\><C-n>", { desc = "Terminal: Exit Terminal Mode" })

-- search pickers (telescope)
map("n", "<leader>h", "<cmd>Telescope help_tags<CR>", { desc = "Search: Help Pages" })
map("n", "<leader>b", "<cmd>Telescope buffers<CR>", { desc = "Search: Open Buffers" })
map("n", "<leader>B", "<cmd>Telescope oldfiles only_cwd=true<CR>", { desc = "Search: Buffer History" })
map("n", "<leader>;", "<cmd>Telescope command_history<CR>", { desc = "Search: Command History" })
map("n", "<leader>f", "<cmd>Telescope find_files<CR>", { desc = "Search: Files" })
map("n", "<leader>/", "<cmd>Telescope current_buffer_fuzzy_find<CR>", { desc = "Search: Current Buffer" })
map("n", "<leader>G", "<cmd>Telescope live_grep<CR>", { desc = "Search: Live Grep" })
map({ "n", "x" }, "<leader>*", "<cmd>Telescope grep_string<CR>", { desc = "Search: Grep Current Selection" })

-- user settings (telescope)
map("n", "<C-,>o", "<cmd>Telescope vim_options<CR>", { desc = "Settings: Vim Options" })
map("n", "<C-,><C-o>", "<cmd>Telescope vim_options<CR>", { desc = "Settings: Vim Options" })
map("n", "<C-,>a", "<cmd>Telescope autocommands<CR>", { desc = "Settings: Autocommands" })
map("n", "<C-,><C-a>", "<cmd>Telescope autocommands<CR>", { desc = "Settings: Autocommands" })
map("n", "<C-,>k", "<cmd>Telescope keymaps<CR>", { desc = "Settings: Keymappings" })
map("n", "<C-,><C-k>", "<cmd>Telescope keymaps<CR>", { desc = "Settings: Keymappings" })
map("n", "<C-,>h", "<cmd>Telescope highlights<CR>", { desc = "Settings: Highlights" })
map("n", "<C-,><C-h>", "<cmd>Telescope highlights<CR>", { desc = "Settings: Highlights" })
map("n", "<C-,>,", Telescope.Dotfiles, { desc = "Settings: Dotfiles" })
map("n", "<C-,><C-,>", Telescope.Dotfiles, { desc = "Settings: Dotfiles" })

-- resume last picker
map("n", "<leader><leader>", "<cmd>Telescope resume<CR>", { desc = "Telescope: Resume Last Picker" })

-- lsp
map("n", "K", LSP.Hover, { desc = "LSP: Hover" })
map("n", "gd", LSP.Definition, { desc = "LSP: Jump to Definition" })
map("n", "gD", LSP.Declaration, { desc = "LSP: Jump to Declaration" })
map("n", "gri", LSP.Implementation, { desc = "LSP: Jump to Implementation" })
map("n", "grd", LSP.Typedef, { desc = "LSP: Jump to Typedef" })
map("n", "grn", LSP.Rename, { desc = "LSP: NvRenamer" })
map("n", "grr", LSP.References, { desc = "LSP: Show References" })
map("n", "gwo", LSP.WorkspaceSymbols, { desc = "LSP: Workspace Symbols" })
map("n", "gwa", LSP.WorkspaceAdd, { desc = "LSP: Add Workspace Folder" })
map("n", "gwr", LSP.WorkspaceRemove, { desc = "LSP: Remove Workspace Folder" })
map("n", "gwl", LSP.WorkspaceList, { desc = "LSP: List Workspace Folder" })
map("i", "<C-s>", LSP.Signature, { desc = "LSP: Signature Help" })

-- diagnostic
map("n", "<leader>d", Diagnostic.Buffer, { desc = "Diagnostic: Show Current Buffer" })
map("n", "<leader>D", Diagnostic.Workspace, { desc = "Diagnostic: Show Workspace" })

-- explorer
map("n", "<M-e>", Explorer.Open, { desc = "Explorer: Open" })
map("n", "<M-S-e>", Explorer.Toggle, { desc = "Explorer: Toggle" })
map("n", "<M-r>", Explorer.Reveal, { desc = "Explorer: Reveal File" })
map("n", "<M-S-r>", Explorer.RevealToggle, { desc = "Explorer: Toggle Auto Reveal" })

-- git (source control)
map({ "n", "t" }, "<M-g>", Git.Status, { desc = "Git: Status" })
map({ "n", "t" }, "<M-S-g>", Git.Log, { desc = "Git: Log" })
map({ "n", "t" }, "<M-b>", Git.Branch, { desc = "Git: Branch" })
map("n", "<leader>gf", Git.FileHistory, { desc = "Git: File History" })
