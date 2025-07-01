local M = {}

M.config = function(opts)
  opts.show_in_active_only = true
  opts.hide_if_all_visible = true

  opts.handle = { blend = 10 }

  opts.marks = {
    GitAdd = { text = "┃" },
    GitChange = { text = "┃" },
    GitDelete = { text = "󰍵" },
  }

  return opts
end

M.setup = function(opts)
  require("scrollbar.handlers.gitsigns").setup()
  require("scrollbar").setup(M.config(opts))
end

return M
