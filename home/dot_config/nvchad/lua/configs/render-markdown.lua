local M = {}

M.config = function(opts)
  opts.anti_conceal = { enabled = false }
  opts.completions = { lsp = { enabled = true } }
  opts.heading = { position = "inline", left_pad = 1, border = true, border_virtual = true }
  opts.code = { style = "normal", border = "thick", left_pad = 2 }
  opts.sign = { enabled = false }
  opts.indent = { enabled = false, icon = "" }

  opts.win_options = {
    number = { default = false, rendered = false },
  }

  return opts
end

return M
