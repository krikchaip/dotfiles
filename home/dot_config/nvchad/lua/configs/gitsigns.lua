local M = {}

M.config = function(opts)
  opts.signs_staged_enable = false
  opts.numhl = true
  opts.attach_to_untracked = true

  opts.current_line_blame = true
  opts.current_line_blame_opts = {
    delay = 500,
    ignore_whitespace = true,
    virt_text_priority = 1000,
  }

  opts.preview_config = { border = "single" }

  return opts
end

return M
