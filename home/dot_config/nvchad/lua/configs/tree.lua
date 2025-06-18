local M = {}

M.config = function(opts)
  return opts
end

M.setup = function(opts)
  require("nvim-tree").setup(M.config(opts))
end

return M
