local M = {}

M.config = function(opts)
  return opts
end

M.setup = function()
  require("tiny-inline-diagnostic").setup(M.config {})
end

return M
