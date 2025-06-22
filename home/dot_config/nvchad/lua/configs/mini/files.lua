local M = {}

M.config = function(opts)
  return opts
end

M.setup = function(opts)
  require("mini.files").setup(M.config(opts))
end

return M
