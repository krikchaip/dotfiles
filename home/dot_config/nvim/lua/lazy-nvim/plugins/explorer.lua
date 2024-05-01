return {
  {
    'nvim-tree/nvim-tree.lua',
    name = 'nvim-tree',
    version = '*',
    lazy = false,
    dependencies = { 'web-devicons' },
    opts = {
      on_attach = function(bufnr)
        local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        local api = require 'nvim-tree.api'

        api.config.mappings.default_on_attach(bufnr)
      end,
    },
    init = function()
      -- disable netrw at the very start of the plugin
      vim.g.loaded_netrw = 1
      vim.g.loaded_netrwPlugin = 1

      -- enable 24-bit colour
      vim.opt.termguicolors = true
    end,
    config = function(_, opts)
      local nvim_tree = require 'nvim-tree'
      local api = require 'nvim-tree.api'

      nvim_tree.setup(opts)

      api.tree.open()
    end
  },
}
