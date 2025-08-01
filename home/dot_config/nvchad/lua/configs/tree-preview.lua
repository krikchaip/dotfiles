local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.border = "single"
  opts.show_title = false

  opts.on_open = function(win, buf)
    vim.wo[win].cursorline = false
    vim.bo[buf].buftype = "nowrite"
  end

  return opts
end

M.setup = function(opts)
  require("nvim-tree-preview").setup(M.config(opts))

  if vim.g.auto_preview_node then
    autocmd("FileType", {
      desc = "Auto toggle preview on tree open",
      group = augroup("tree-preview", { clear = true }),
      pattern = "NvimTree",
      callback = function(args)
        autocmd("BufEnter", { buffer = args.buf, callback = M.toggle })
      end,
    })
  end
end

M.toggle = vim.schedule_wrap(function()
  local preview = require "nvim-tree-preview"

  if not preview.is_watching() then
    preview.watch()
  else
    preview.unwatch()
  end
end)

M.scroll_down = function()
  require("nvim-tree-preview").scroll(8)
end

M.scroll_up = function()
  require("nvim-tree-preview").scroll(-8)
end

return M
