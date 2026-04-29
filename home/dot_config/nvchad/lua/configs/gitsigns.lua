local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

---@module 'gitsigns'
---@param opts Gitsigns.Config
M.config = function(opts)
  opts.signs_staged_enable = false
  opts.numhl = true
  opts.attach_to_untracked = true

  opts.current_line_blame = true
  opts.current_line_blame_opts = {
    delay = 500,
    ignore_whitespace = true,
  }

  opts.preview_config = { border = "single" }

  return opts
end

M.setup = function(opts)
  require("gitsigns").setup(M.config(opts))

  -- Detach gitsigns before buffer delete to prevent async blame nil-repo crash.
  -- current_line_blame runs async; if Obj:close() nil's repo mid-flight it errors.
  autocmd("BufDelete", {
    desc = "Detach gitsigns before buffer delete to avoid async blame nil-repo crash",
    group = augroup("gitsigns-safe-detach", { clear = true }),
    callback = function(args)
      pcall(require("gitsigns").detach, args.buf)
    end,
  })
end

return M
