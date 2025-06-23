local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.mappings = {
    go_in = "L",
    go_in_plus = "l",
    go_out = "",
    go_out_plus = "h",
  }

  opts.windows = {
    preview = true,
    width_focus = 30,
    width_preview = 60,
  }

  return opts
end

M.setup = function(opts)
  require("mini.files").setup(M.config(opts))

  -- Snacks.rename integration for mini.files
  -- ref: https://github.com/folke/snacks.nvim/blob/main/docs/rename.md#minifiles
  autocmd("User", {
    group = augroup("mini-files.integration", { clear = true }),
    pattern = "MiniFilesActionRename",
    callback = function(args)
      Snacks.rename.on_rename_file(args.data.from, args.data.to)
    end,
  })
end

M.open = function()
  local MiniFiles = require "mini.files"
  MiniFiles.open()
end

return M
