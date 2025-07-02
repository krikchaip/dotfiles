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

  opts.keymap["<Tab>"] = false
  opts.keymap["<S-Tab>"] = false

  opts.keymap["<C-.>"] = { "snippet_forward" }
  opts.keymap["<C-,>"] = { "snippet_backward" }

  opts.cmdline.keymap = {
    ["<C-e>"] = false,
    ["<C-Space>"] = { "show", "hide" },
  }

  opts.completion.ghost_text.show_with_menu = false

  return opts
end

return M
