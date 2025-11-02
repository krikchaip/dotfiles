local M = {}

---@module 'snacks'
---@param opts snacks.Config
M.config = function(opts)
  -- force Snacks to detect kitty terminal when rendering images
  vim.env.SNACKS_KITTY = true

  opts.image = { enabled = true }
  opts.input = { enabled = true, expand = false }
  opts.notifier = { enabled = true, filter = M.notifier_filter }
  opts.scope = { enabled = true, keys = { jump = nil } }

  opts.statuscolumn = {
    enabled = true,
    left = { "sign", "git" },
    right = { "fold" },
    folds = { open = true },
    refresh = 20,
  }

  opts.words = {
    enabled = true,
    debounce = 250,
    notify_end = false,
    modes = { "n", "i" },
  }

  opts.styles = {
    input = {
      title_pos = "left",
      relative = "cursor",
      width = 30,
      keys = { i_esc = { "<esc>", "cancel", mode = "i", expr = true } },
    },
  }

  return opts
end

---@param notif snacks.notifier.Notif
M.notifier_filter = function(notif)
  -- temporary fix for https://github.com/mfussenegger/nvim-lint/issues/744
  if notif.msg:find "`golangci%-lint` exited with code: 5" then return false end

  -- a quick hack to mute tree_preview.toggle()
  if notif.msg:find "current buffer is not NvimTree" then return false end

  return true
end

return M
