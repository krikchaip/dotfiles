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

  opts.keymap["<Tab>"] = { "snippet_forward", "fallback" }
  opts.keymap["<S-Tab>"] = { "snippet_backward", "fallback" }

  opts.cmdline.keymap = {
    ["<S-Tab>"] = false,
    ["<C-e>"] = false,

    ["<Tab>"] = { "show_and_insert", "accept" },
    ["<C-Space>"] = { "show", "hide" },
  }

  return opts
end

return M
