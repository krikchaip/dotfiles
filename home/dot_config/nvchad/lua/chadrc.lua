-- This file needs to have same structure as nvconfig.lua
-- https://github.com/NvChad/ui/blob/v3.0/lua/nvconfig.lua
-- Please read that file to know all available options :(

---@type ChadrcConfig
local M = {}

M.base46 = {
  theme = "embark",
}

M.ui = {
  statusline = {
    theme = "vscode_colored",
  },
  tabufline = {
    lazyload = false,
  },
}

M.nvdash = {
  load_on_startup = true,
}

M.cheatsheet = {
  theme = "simple",
}

return M
