local M = {}

M.config = function(opts)
  opts.preset = "powerline"

  opts.options = {
    show_source = { enabled = true },
    use_icons_from_diagnostic = true,
    overflow = { padding = 3 },
  }

  return opts
end

M.setup = function()
  require("tiny-inline-diagnostic").setup(M.config {})
end

return M
