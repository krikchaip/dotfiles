local M = {}

M.config = function(opts)
  opts.formatters_by_ft = {
    html = { "prettierd" },
    css = { "prettierd" },

    javascript = { "prettierd" },
    typescript = { "prettierd" },
    javascriptreact = { "prettierd" },
    typescriptreact = { "prettierd" },
    vue = { "prettierd" },

    json = { "prettierd" },
    yaml = { "yamlfmt", lsp_format = "fallback" },

    markdown = { "prettierd" },

    go = { "goimports-reviser", "gofumpt", "golines" },
    gomod = { lsp_format = "prefer" },
    gowork = { lsp_format = "prefer" },
    gotmpl = { lsp_format = "prefer" },

    python = { "isort", "black", "ruff_format" },
    htmldjango = { "djlint" },

    lua = { "stylua" },
    nu = { "nufmt", lsp_format = "fallback" },
  }

  opts.notify_on_error = false
  opts.notify_no_formatters = false

  return opts
end

return M
