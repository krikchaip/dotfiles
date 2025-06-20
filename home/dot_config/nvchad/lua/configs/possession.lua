local M = {}

M.config = function(opts)
  opts.prompt_no_cr = true
  opts.autosave = { current = true, cwd = true }
  opts.plugins = { delete_buffers = true, delete_hidden_buffers = false }

  return opts
end

return M
