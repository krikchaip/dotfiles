local M = {}

---@module 'blink.cmp'
---@param opts blink.cmp.Config
M.config = function(opts)
  -- ref: https://github.com/folke/lazydev.nvim#-installation
  opts.sources.default = { "lazydev", "lsp", "snippets", "buffer", "path" }
  opts.sources.providers = {
    lazydev = {
      name = "LazyDev",
      module = "lazydev.integrations.blink",
      score_offset = 100,
    },
  }

  return opts
end

return M
