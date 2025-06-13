require "nvchad.options"

local opt = vim.opt
local o = vim.o

-- to enable cursorline!
o.cursorlineopt = "both"

-- do not wrap lines
o.wrap = false

-- every wrapped line will continue visually indented
o.breakindent = true

-- minimal number of screen lines to keep above and below the cursor.
o.scrolloff = 5

-- columns to scroll horizontally when texts are off the screen
o.sidescrolloff = 4

-- no swapfile. EVER 😠
o.swapfile = false

-- set highlight on search
o.hlsearch = true

-- preview substitutions live, as you type!
o.inccommand = "split"

-- prevent folds to accidentally open while moving horizontally
opt.foldopen:remove "hor"

-- sets how neovim will display certain whitespace characters in the editor.
o.list = true
opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }

-- enable 24-bit colour in terminal
o.termguicolors = true
