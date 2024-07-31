function setup_lsp_keymaps(opts)
  opts.desc = 'LSP: Hover Documentation'
  vim.keymap.set('n', 'K', vim.lsp.buf.hover, opts)

  opts.desc = 'LSP: Show Function Signature Help'
  vim.keymap.set({ 'n', 'i' }, '<C-S-Space>', vim.lsp.buf.signature_help, opts)

  opts.desc = 'LSP: Jump to Definition'
  vim.keymap.set('n', 'gd', "<cmd>lua require('goto-preview').goto_preview_definition()<CR>", opts)

  opts.desc = 'LSP: Jump to Typedef'
  vim.keymap.set('n', 'gD', "<cmd>lua require('goto-preview').goto_preview_type_definition()<CR>", opts)

  opts.desc = 'LSP: Jump to Implementation'
  vim.keymap.set('n', 'gI', "<cmd>lua require('goto-preview').goto_preview_implementation()<CR>", opts)

  opts.desc = 'LSP: Show References'
  vim.keymap.set('n', 'gr', "<cmd>lua require('goto-preview').goto_preview_references()<CR>", opts)

  opts.desc = 'LSP: Rename Variable'
  vim.keymap.set('n', 'gR', vim.lsp.buf.rename, opts)

  opts.desc = 'LSP: Execute Code Action'
  vim.keymap.set('n', '<C-.>', vim.lsp.buf.code_action, opts)

  opts.desc = 'LSP: Search Document Symbols'
  vim.keymap.set('n', '<leader>o', '<cmd>lua require("nvim-navbuddy").open()<CR>', opts)

  opts.desc = 'LSP: Search Workspace Symbols'
  vim.keymap.set('n', '<leader>O', '<cmd>Telescope lsp_dynamic_workspace_symbols<CR>', opts)
end
