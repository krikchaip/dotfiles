local M = {}

M.config = function(opts)
  opts.outline_window = {
    width = 40,
    relative_width = false,
    auto_close = true,
    auto_jump = true,
    jump_highlight_duration = false,
  }

  opts.outline_items = {
    show_symbol_lineno = false,
  }

  opts.keymaps = {
    show_help = { "g?", "?", "<C-/>" },
    close = "q",
    hover_symbol = "K",
    toggle_preview = "p",
    fold = { "h", "<BS>", "<Left>" },
    unfold = { "l", "<Right>" },
    fold_toggle = ".",
    fold_toggle_all = ">",
    fold_all = { "H", "<S-BS>", "<S-Left>" },
    unfold_all = { "E", "L", "<S-Right>" },
  }

  opts.providers = {
    priority = { "test_blocks", "lsp", "markdown", "norg", "treesitter", "man" },
  }

  return opts
end

return M
