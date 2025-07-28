local M = {}

M.options = function()
  vim.cmd "highlight! LspSignatureActiveParameter NONE"
  vim.cmd "highlight! LspSignatureActiveParameter gui=bold"
end

M.config = function(opts)
  opts.filetypes = { "markdown", "codecompanion" }
  opts.anti_conceal = { enabled = false }
  opts.completions = { blink = { enabled = true } }
  opts.heading = { position = "inline", left_pad = 1, border = true, border_virtual = true }
  opts.code = { style = "normal", border = "thick", left_pad = 2 }
  opts.quote = { repeat_linebreak = true }
  opts.sign = { enabled = false }
  opts.indent = { enabled = false, icon = "" }

  opts.win_options = {
    linebreak = { default = true, rendered = true },
    showbreak = { default = "  ", rendered = "  " },
    breakindent = { default = true, rendered = true },
    wrap = { default = true, rendered = true },
    number = { default = false, rendered = false },
  }

  opts.overrides = {
    buftype = {
      nofile = {
        code = { border = "thin", left_pad = 0 },
      },
    },
  }

  return opts
end

M.setup = function(opts)
  M.options()
  require("render-markdown").setup(M.config(opts))
end

return M
