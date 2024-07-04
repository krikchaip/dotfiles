function setup_diagnostic_keymaps(event)
  local opts = { buffer = event.buf, silent = true }

  opts.desc = 'LSP: Diagnostic'
  vim.keymap.set('n', ']d', vim.diagnostic.goto_next, opts)

  opts.desc = 'LSP: Diagnostic'
  vim.keymap.set('n', '[d', vim.diagnostic.goto_prev, opts)

  opts.desc = 'LSP: Show Diagnostic Popup'
  vim.keymap.set('n', 'gh', vim.diagnostic.open_float, opts)
end
