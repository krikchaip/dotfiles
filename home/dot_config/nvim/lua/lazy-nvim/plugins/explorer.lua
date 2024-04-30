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
        vim.keymap.set('n', 'o', api.node.open.edit, opts)

        opts.desc = 'Close Directory'
        vim.keymap.set('n', 'O', api.node.navigate.parent_close, opts)

        opts.desc = 'Open Preview'
        vim.keymap.set('n', '<Tab>', api.node.open.preview, opts)

        opts.desc = 'Open: New Tab'
        vim.keymap.set('n', '<C-t>', api.node.open.tab, opts)

        opts.desc = 'Open: Vertical Split'
        vim.keymap.set('n', '<C-v>', api.node.open.vertical, opts)

        opts.desc = 'Open: Horizontal Split'
        vim.keymap.set('n', '<C-s>', api.node.open.horizontal, opts)

        opts.desc = 'Rename: Omit Filename'
        vim.keymap.set('n', 'r', api.fs.rename_sub, opts)

        opts.desc = 'Create File Or Directory'
        vim.keymap.set('n', 'a', api.fs.create, opts)

        opts.desc = 'Copy'
        vim.keymap.set('n', 'yy', api.fs.copy.node, opts)

        opts.desc = 'Prev Git Change'
        vim.keymap.set('n', '[c', api.node.navigate.git.prev, opts)

        opts.desc = 'Next Git Change'
        vim.keymap.set('n', ']c', api.node.navigate.git.next, opts)
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
