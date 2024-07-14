-- Limit fold columns to just one (chevron icon)
vim.opt.foldcolumn = '1'

-- Folds will be enabled again by plugins
vim.opt.foldenable = true

-- Open (expand) all folds by default
-- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
vim.opt.foldlevel = 999
vim.opt.foldlevelstart = 999

-- custom set of fold characters on statuscol
vim.opt.fillchars = {
  eob = ' ',
  fold = ' ',
  foldsep = ' ',
  foldopen = '',
  foldclose = '',
}
