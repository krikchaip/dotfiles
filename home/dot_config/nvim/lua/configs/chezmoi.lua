local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.events = {
    on_open = { notification = { enable = false } },
    on_watch = { notification = { enable = false } },
  }

  return opts
end

M.setup = function(opts)
  require("chezmoi").setup(M.config(opts))

  -- automatically apply changes on files under chezmoi source path
  -- ref: https://github.com/xvzc/chezmoi.nvim#automatically-running-chezmoi-apply-in-specific-directories
  autocmd({ "BufRead", "BufNewFile" }, {
    group = augroup("chezmoi-watch", { clear = true }),
    pattern = { "*/.local/share/chezmoi/*" },
    callback = function(args)
      vim.schedule(function()
        require("chezmoi.commands.__edit").watch(args.buf)
      end)
    end,
  })
end

return M
