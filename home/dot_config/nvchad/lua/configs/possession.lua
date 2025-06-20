local M = {}

M.config = function(opts)
  opts.prompt_no_cr = true
  opts.autosave = { current = true, cwd = true }

  opts.hooks = {
    after_load = function()
      vim.cmd "let @/=''"
    end,
  }

  opts.plugins = {
    delete_buffers = true,
    delete_hidden_buffers = false,
  }

  return opts
end

return M
