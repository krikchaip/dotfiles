vim.cmd('set expandtab')
vim.cmd('set shiftwidth=2')
vim.cmd('set softtabstop=2')
vim.cmd('set tabstop=2')
vim.cmd('set shell=nu')

-- vim.g.mapleader = '\\'
vim.g.mapleader = ' '

vim.g.loaded_python3_provider = 0
vim.g.loaded_ruby_provider = 0
vim.g.loaded_node_provider = 0
vim.g.loaded_perl_provider = 0

vim.keymap.set('n', '<leader>bd', ':bdelete<Cr>', { desc = "hello world!" })

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
    'nathom/filetype.nvim',
    priority = 1000,
    config = function()
      require('filetype').setup({
        overrides = {
          extensions = {
            -- nu = 'nu',
            -- tmpl = 'template'
          }
        }
      })
    end
  },
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
      'nvim-tree/nvim-web-devicons',
      { 'nvim-telescope/telescope-fzf-native.nvim', build = 'make' }
    },
    config = function()
      local telescope = require('telescope')
      local builtin = require('telescope.builtin')

      telescope.setup({
        defaults = {},
        pickers = {}
      })

      telescope.load_extension('fzf')

      vim.keymap.set('n', '<leader>fe', builtin.find_files, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>fw', ':Telescope grep_string search="" only_sort_text=true<Cr>',
        { desc = "hello world!" })
      -- vim.keymap.set('n', '<leader>fw', builtin.live_grep, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>bl', builtin.buffers, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>bh', builtin.oldfiles, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>cm', builtin.commands, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>ch', builtin.command_history, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>/', builtin.search_history, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>hh', builtin.help_tags, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>hm', builtin.man_pages, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>mk', builtin.marks, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>sc', builtin.colorscheme, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>jj', builtin.jumplist, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>vo', builtin.vim_options, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>"', builtin.registers, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>va', builtin.autocommands, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>vk', builtin.keymaps, { desc = "hello world!" })
      vim.keymap.set('n', '<leader>ff', builtin.current_buffer_fuzzy_find, { desc = "hello world!" })
      vim.keymap.set('n', '<leader><leader>', builtin.resume, { desc = "hello world!" })
    end
  },
  {
    'nvim-treesitter/nvim-treesitter',
    dependencies = {
      'nushell/tree-sitter-nu'
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
        ensure_installed = { 'lua', 'vim', 'vimdoc', 'query', 'elixir', 'javascript', 'html' },
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
