local M = {}

M.config = function(opts)
  opts.silent = true
  opts.prompt_no_cr = true

  local autosave = vim.fn.argc() == 0
  opts.autosave = { current = autosave, cwd = autosave }

  opts.hooks = {
    before_save = function()
      return { tabufline = Tabufline.Serialize() }
    end,
    after_load = function(_, data)
      vim.cmd "let @/=''"
      vim.cmd "silent! argdelete"

      Tabufline.Load(data.tabufline)
    end,
  }

  opts.plugins = {
    delete_buffers = true,
    delete_hidden_buffers = false,
  }

  return opts
end

return M
