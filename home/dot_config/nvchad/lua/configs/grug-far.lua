local M = {}

M.config = function(opts)
  opts.normalModeSearch = true
  opts.windowCreationCommand = "80vsplit"
  opts.wrap = false
  opts.transient = true

  opts.keymaps = {
    close = { n = "q", i = "<C-q>" },
    openLocation = { n = "<S-CR>" },
    openNextLocation = false,
    openPrevLocation = false,
    nextInput = { n = "]]" },
    prevInput = { n = "[[" },
  }

  opts.folding = { foldlevel = 999 }
  opts.openTargetWindow = { preferredLocation = "prev", useScratchBuffer = false }

  return opts
end

M.setup = function()
  dofile(vim.g.base46_cache .. "grug_far")
  require("grug-far").setup(M.config {})
end

return M
