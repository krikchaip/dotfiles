-- Make line numbers default
vim.opt.number = true

-- Show which line your cursor is on
vim.opt.cursorline = true

-- Do not wrap lines
vim.opt.wrap = false

-- Minimal number of screen lines to keep above and below the cursor.
vim.opt.scrolloff = 5

-- Columns to scroll horizontally when texts are off the screen
vim.opt.sidescrolloff = 4

-- Enable mouse mode, can be useful for resizing splits for example!
vim.opt.mouse = 'a'

-- Don't show the mode, since it's already in the status line
vim.opt.showmode = false

-- Always show tabline (0 = 'never', 1 = 'atleast two', 2 = 'always')
vim.opt.showtabline = 0

-- Sync clipboard between OS and Neovim.
vim.opt.clipboard = 'unnamedplus'

-- Enable break indent
vim.opt.breakindent = true

-- Save undo history
vim.opt.undofile = false

-- No swapfile. EVER 😠
vim.opt.swapfile = false

-- Set highlight on search
vim.opt.hlsearch = true

-- Preview substitutions live, as you type!
vim.opt.inccommand = 'split'

-- Case-insensitive searching UNLESS \C or one or more capital letters in the search term
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Decrease update time (default 4000ms, floating menus popup sooner on hover)
vim.opt.updatetime = 250

-- Decrease mapped sequence wait time (displays which-key popup sooner)
vim.opt.timeoutlen = 500

-- Configure how new splits should be opened
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Keep signcolumn on by default
vim.opt.signcolumn = 'no'

-- Sets how neovim will display certain whitespace characters in the editor.
vim.opt.list = true
vim.opt.listchars = { tab = '» ', trail = '·', nbsp = '␣' }

-- Enable 24-bit colour
vim.opt.termguicolors = true

-- Disable Nvim intro message and other annoying messages
vim.opt.shortmess:append 'sI'
