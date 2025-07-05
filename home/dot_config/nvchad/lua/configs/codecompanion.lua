local M = {}

M.config = function(opts)
  opts.strategies = {
    chat = { adapter = "gemini" },
    inline = { adapter = "gemini" },
    cmd = { adapter = "gemini" },
  }

  return opts
end

return M
