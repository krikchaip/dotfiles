local M = {}

---@module 'snacks'
---@param opts snacks.Config
M.config = function(opts)
  opts.image = { enabled = true }
  opts.notifier = { enabled = true }

  return opts
end

return M
