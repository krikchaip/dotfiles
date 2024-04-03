vim.cmd('set expandtab')
vim.cmd('set shiftwidth=2')
vim.cmd('set softtabstop=2')
vim.cmd('set tabstop=2')
vim.cmd('set shell=nu')

vim.g.mapleader = '\\'

vim.keymap.set('n', '<leader>bd', ':bdelete<Cr>')

local lazypath = vim.fn.stdpath('data') .. '/lazy/lazy.nvim'

if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    'git',
    'clone',
    '--filter=blob:none',
    'https://github.com/folke/lazy.nvim.git',
    '--branch=stable', -- latest stable release
    lazypath,
  })
end

vim.opt.rtp:prepend(lazypath)

local plugins = {
  {
    'loctvl842/monokai-pro.nvim',
    lazy = false,
    priority = 1000,
    config = function()
      require('monokai-pro').setup({
        transparent_background = true,
        inc_search = 'underline'
      })

      vim.cmd([[colorscheme monokai-pro]])
    end
  },
  {
    'nvim-telescope/telescope.nvim',
    branch = '0.1.x',
    dependencies = {
      'nvim-lua/plenary.nvim',
      { 'nvim-telescope/telescope-fzf-native.nvim', build = 'make' }
    },
    config = function()
      local telescope = require('telescope')
      local builtin = require('telescope.builtin')

      telescope.setup({})

      telescope.load_extension('fzf')

      vim.keymap.set('n', '<leader>ff', builtin.find_files, {})
      vim.keymap.set('n', '<leader>lg', builtin.live_grep, {})
      vim.keymap.set('n', '<leader>bl', builtin.buffers, {})
    end
  },
  {
    'nvim-treesitter/nvim-treesitter',
    dependencies = {
      { 'nushell/tree-sitter-nu' }
    },
    build = ':TSUpdate',
    config = function()
      local configs = require('nvim-treesitter.configs')
      local parser_configs = require('nvim-treesitter.parsers').get_parser_configs()

      parser_configs.nu = {
        install_info = {
          url = 'https://github.com/nushell/tree-sitter-nu',
          files = { 'src/parser.c' },
          branch = 'main',
        },
        filetype = 'nu',
      }

      configs.setup({
        auto_install = true,
        highlight = {
          enable = true,
          disable = { 'json' }
        },
        indent = {
          enable = true
        },
        incremental_selection = {
          enable = true,
          keymaps = {
            init_selection = 'gnn',
            node_incremental = 'grn',
            scope_incremental = 'grc',
            node_decremental = 'grm',
          },
        },
      })

      vim.treesitter.language.register('gotmpl', 'template')

      vim.cmd('set foldmethod=expr')
      vim.cmd('set foldexpr=nvim_treesitter#foldexpr()')
      vim.cmd('set nofoldenable')
    end
  }
}

local opts = {
  install = {
    colorscheme = { 'monokai-pro' }
  }
}

require('lazy').setup(plugins, opts)
