local M = {}

M.config = function(opts)
  opts.border = "single"
  opts.show_title = false

  opts.on_open = function(win, buf)
    vim.wo[win].cursorline = false
    vim.bo[buf].buftype = "nowrite"
  end

  return opts
end

M.toggle = function()
  local preview = require "nvim-tree-preview"

  if not preview.is_watching() then
    preview.watch()
  else
    preview.unwatch()
  end
end

M.scroll_down = function()
  require("nvim-tree-preview").scroll(8)
end

M.scroll_up = function()
  require("nvim-tree-preview").scroll(-8)
end

return M
