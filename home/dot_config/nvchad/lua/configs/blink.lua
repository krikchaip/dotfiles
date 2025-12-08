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

  -- ref: https://cmp.saghen.dev/configuration/keymap.html#super-tab
  opts.completion.trigger = { show_in_snippet = false }
  opts.completion.list = { selection = { preselect = M.snippet_inactive } }

  opts.keymap["<Tab>"] = false
  opts.keymap["<S-Tab>"] = false

  opts.keymap["<C-.>"] = { M.snippet_expand, "snippet_forward" }
  opts.keymap["<C-,>"] = { "snippet_backward" }

  opts.cmdline.keymap = {
    ["<C-e>"] = false,
    ["<C-Space>"] = { "show", "hide" },
  }

  return opts
end

---@param cmp blink.cmp.API
M.snippet_expand = function(cmp)
  if cmp.snippet_active() then
    return cmp.accept()
  else
    return cmp.select_and_accept()
  end
end

---@param ctx blink.cmp.Context
M.snippet_inactive = function(ctx)
  return not require("blink.cmp").snippet_active { direction = 1 }
end

return M
