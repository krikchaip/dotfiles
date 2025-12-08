local M = {}

local map = vim.keymap.set

M.condition = function()
  local cwd = vim.uv.cwd()
  local nx_json = vim.fs.joinpath(cwd, "nx.json")

  return vim.fn.filereadable(nx_json) == 1
end

M.config = function(opts)
  opts.nx_cmd_root = M.prefix_package_manager "nx"

  return opts
end

M.setup = function(opts)
  require("nx").setup(M.config(opts))
  M.on_attach()
end

M.on_attach = function()
  local function opts(desc)
    return { desc = "Nx: " .. desc, noremap = true, silent = true, nowait = true }
  end

  map("n", "<leader>xa", Nx.Targets, opts "Browse Targets")
  map("n", "<leader>xm", Nx.RunMany, opts "Browse Targets (Run many)")
  map("n", "<leader>xf", Nx.RunAffected, opts "Browse Targets (Run affected)")
  map("n", "<leader>xg", Nx.Generators, opts "Browse Generators")
  map("n", "<leader>xr", Nx.Reload, opts "Reload Configuration")
end

---@param command string
M.prefix_package_manager = function(command)
  local cwd = vim.uv.cwd()

  -- order lockfiles by priority
  local lockfiles = {
    { name = "bun.lock", cmd = "bun" },
    { name = "pnpm-lock.yaml", cmd = "pnpm" },
    { name = "yarn.lock", cmd = "yarn" },
  }

  local prefix = vim.iter(lockfiles):find(function(lockfile)
    local lockfile_path = vim.fs.joinpath(cwd, lockfile.name)
    return vim.fn.filereadable(lockfile_path) == 1
  end) or { cmd = "npm" }

  return string.format("%s %s", prefix.cmd, command)
end

return M
