local M = {}

M.condition = function()
  local cwd = vim.uv.cwd()
  local nx_json = vim.fs.joinpath(cwd, "nx.json")

  return vim.fn.filereadable(nx_json) == 1
end

M.config = function(opts)
  return opts
end

M.setup = function(opts)
  require("nx").setup(M.config(opts))
end

return M
