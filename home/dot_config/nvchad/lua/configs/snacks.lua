local M = {}

---@module 'snacks'
---@param opts snacks.Config
M.config = function(opts)
  opts.image = { enabled = true }
  opts.notifier = { enabled = true, filter = M.notifier_filter }

  return opts
end

---@param notif snacks.notifier.Notif
M.notifier_filter = function(notif)
  -- temporary fix for https://github.com/mfussenegger/nvim-lint/issues/744
  if notif.msg:find "`golangci%-lint` exited with code: 5" then return false end

  return true
end

return M
