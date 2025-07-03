local M = {}

M.config = function(opts)
  opts.normalModeSearch = true
  opts.transient = true

  opts.keymaps = {
    nextInput = { n = "]]" },
    prevInput = { n = "[[" },
  }

  return opts
end

M.setup = function()
  require("grug-far").setup(M.config {})
end

return M
