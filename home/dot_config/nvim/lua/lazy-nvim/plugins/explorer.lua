return {
  {
    'nvim-tree/nvim-tree.lua',
    name = 'nvim-tree',
    version = '*',
    lazy = false,
    dependencies = { 'web-devicons' },
    opts = {
      on_attach = function(bufnr)
        local api = require 'nvim-tree.api'

        local opts = { buffer = bufnr, silent = true, nowait = true }

        opts.desc = 'Toggle Help'
        vim.keymap.set('n', '?', api.tree.toggle_help, opts)

        opts.desc = 'Show Info'
        vim.keymap.set('n', 'i', api.node.show_info_popup, opts)

        opts.desc = 'Open'
        vim.keymap.set('n', 'J', api.node.open.edit, opts)
        vim.keymap.set('n', '<CR>', api.node.open.edit, opts)

        opts.desc = 'Close Directory'
        vim.keymap.set('n', 'K', api.node.navigate.parent_close, opts)
        vim.keymap.set('n', '<BS>', api.node.navigate.parent_close, opts)
      end,
    },
    init = function()
      -- disable netrw at the very start of the plugin
      vim.g.loaded_netrw = 1
      vim.g.loaded_netrwPlugin = 1

      -- enable 24-bit colour
      vim.opt.termguicolors = true
    end,
  },
}
