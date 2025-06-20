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
  buttons = {
    {
      txt = "󰾩  Restore Session",
      keys = "r",
      cmd = ":lua if not pcall(vim.cmd, 'PossessionLoadCwd') then vim.cmd 'enew' end",
    },
    { txt = "  Find File", keys = "f", cmd = "Telescope find_files" },
    { txt = "  Recent Files", keys = "o", cmd = "Telescope oldfiles only_cwd=true" },
    { txt = "󰈭  Find Word", keys = "g", cmd = "Telescope live_grep" },
    { txt = "󱥚  Themes", keys = "t", cmd = ":lua require('nvchad.themes').open()" },
    { txt = "  Mappings", keys = "m", cmd = "Telescope keymaps" },
    { txt = "─", hl = "NvDashFooter", no_gap = true, rep = true },
    {
      txt = function()
        local stats = require("lazy").stats()
        local ms = math.floor(stats.startuptime) .. " ms"
        return "  Loaded " .. stats.loaded .. "/" .. stats.count .. " plugins in " .. ms
      end,
      hl = "NvDashFooter",
      no_gap = true,
    },
    { txt = "─", hl = "NvDashFooter", no_gap = true, rep = true },
  },
}

M.term = {
  sizes = { vsp = 0.3, ["bo vsp"] = 0.3 },
}

M.cheatsheet = {
  theme = "simple",
}

return M
