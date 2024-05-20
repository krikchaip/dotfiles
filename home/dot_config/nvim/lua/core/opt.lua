-- [[ option-list, vim.opt, vim.o, vim.g ]]

-- Set <space> as the leader key
-- NOTE: Must happen before plugins are loaded (otherwise wrong leader will be used)
vim.g.mapleader = ' '
vim.g.maplocalleader = ' '

-- Set to true if you have a Nerd Font installed
vim.g.have_nerd_font = true

-- Nushell config paths
vim.g.nu_config_path = '~/Library/Application Support/nushell/config.nu'
vim.g.nu_env_path = '~/Library/Application Support/nushell/env.nu'

-- Make line numbers default
vim.opt.number = true

-- Show relative line numbers (to help with jumping)
-- vim.opt.relativenumber = true

-- Do not wrap lines
vim.opt.wrap = false

-- Columns to scroll horizontally when texts are off the screen
vim.opt.sidescrolloff = 4

-- Enable mouse mode, can be useful for resizing splits for example!
vim.opt.mouse = 'a'

-- Don't show the mode, since it's already in the status line
vim.opt.showmode = false

-- Always show tabline (0 = 'never', 1 = 'atleast two', 2 = 'always')
vim.opt.showtabline = 2

-- Sync clipboard between OS and Neovim.
-- NOTE: remove this option if you want your OS clipboard to remain independent.
vim.opt.clipboard = 'unnamedplus'

-- Enable break indent
vim.opt.breakindent = true

-- Save undo history
vim.opt.undofile = true

-- No swapfile. EVER 😠
vim.opt.swapfile = false

-- Case-insensitive searching UNLESS \C or one or more capital letters in the search term
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Keep signcolumn on by default
vim.opt.signcolumn = 'yes'

-- Decrease update time (default 4000ms, floating menus popup sooner on hover)
vim.opt.updatetime = 500

-- Decrease mapped sequence wait time (displays which-key popup sooner)
vim.opt.timeoutlen = 500

-- Configure how new splits should be opened
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Disable initial folds by setting this value to a high number
-- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
vim.opt.foldenable = true
vim.opt.foldcolumn = '1'
vim.opt.foldlevel = 999
vim.opt.foldlevelstart = 999

-- Sets how neovim will display certain whitespace characters in the editor.
vim.opt.list = true
vim.opt.listchars = { tab = '» ', trail = '·', nbsp = '␣' }

-- Preview substitutions live, as you type!
vim.opt.inccommand = 'split'

-- Show which line your cursor is on
vim.opt.cursorline = true

-- Minimal number of screen lines to keep above and below the cursor.
vim.opt.scrolloff = 5

-- Set highlight on search
vim.opt.hlsearch = true

-- Configure the default shell to nushell
-- ref: https://github.com/neovim/neovim/issues/19648
vim.opt.shell = 'nu'
vim.opt.shelltemp = false
vim.opt.shellcmdflag = '--stdin ' .. '--config "' .. vim.g.nu_config_path .. '" --env-config "' .. vim.g.nu_env_path .. '" -c'
