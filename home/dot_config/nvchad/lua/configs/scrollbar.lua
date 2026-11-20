local M = {}

M.config = function(opts)
  opts.exclude = { buftypes = { nofile = true } }
  opts.providers = { gitsigns = true }
  opts.marks = { GitDelete = { text = "󰍵" } }
  opts.scrollbar = {
    visibility = "active",
    hide_if_all_visible = true,
    thumb = { blend = 10 },
  }

  return opts
end

M.setup = function(opts)
  require("scrollbar").setup(M.config(opts))
end

return M
