local M = {}

--- @param opts opencode.Opts
M.config = function(opts)
  opts.ask = {
    snacks = { icon = "", win = { width = 33, footer_pos = "left" } },
  }

  return opts
end

M.setup = function(opts)
  -- Required for `opts.events.reload`
  vim.o.autoread = true

  ---@type opencode.Opts
  vim.g.opencode_opts = M.config(opts)
end

return M
