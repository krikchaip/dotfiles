local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup
local map = vim.keymap.set

M.config = function(opts)
  opts.func_map = {
    tabdrop = "<M-o>",
    prevhist = "[[",
    nexthist = "]]",
    stoggleup = ">",
    stoggledown = ".",
    stogglevm = ".",
    stogglebuf = "'.",
    sclear = "z.",
  }

  return opts
end

M.setup = function(opts)
  require("bqf").setup(M.config(opts))

  autocmd("FileType", {
    group = augroup("bqf.mapping", { clear = true }),
    pattern = "qf",
    callback = function(args)
      M.on_attach(args.buf)
    end,
  })
end

M.on_attach = function(bufnr)
  local function opts(desc)
    return { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
  end

  map("n", "q", "<cmd>cclose | lclose<CR>", opts "Close quickfix window")
end

return M
