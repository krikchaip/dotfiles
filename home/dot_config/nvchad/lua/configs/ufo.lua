local M = {}

local opt = vim.opt
local o = vim.o

M.options = function()
  -- limit fold columns to just one (chevron icon)
  o.foldcolumn = "1"

  -- expand all folds by default
  -- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
  o.foldlevel = 999
  o.foldlevelstart = 999

  -- folds will be reenabled by the plugin
  o.foldenable = true

  -- custom set of fold characters on statuscol
  opt.fillchars = { eob = " ", fold = " ", foldsep = " ", foldopen = "", foldclose = "" }
end

M.config = function(opts)
  return opts
end

M.setup = function(opts)
  M.options()
  require("ufo").setup(M.config(opts))
end

return M
