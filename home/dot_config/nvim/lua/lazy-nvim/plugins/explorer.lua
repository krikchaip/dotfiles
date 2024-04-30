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
