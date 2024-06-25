local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

return {
  -- Help improve Telescope sorting performance
  {
    'nvim-telescope/telescope-fzf-native.nvim',
    name = 'telescope.fzf',
    build = 'make', -- run only when the plugin is installed/updated
    cond = function() -- will enable only when `make` in available
      return vim.fn.executable 'make' == 1
    end,
  },

  -- Telescope LuaSnip snippets picker
  {
    'benfowler/telescope-luasnip.nvim',
    name = 'telescope.luasnip',
    keys = {
      { '<C-\\>', '<cmd>Telescope luasnip<CR>', desc = 'Search: LuaSnip Snippets', mode = { 'n', 'i' } },
    },
    dependencies = { 'telescope', 'luasnip' },
    config = function() require('telescope').load_extension 'luasnip' end,
  },

  -- Telescope session lens picker
  {
    'rmagatti/session-lens',
    name = 'telescope.session-lens',
    cmd = { 'SearchSession' },
    dependencies = { 'telescope', 'auto-session' },
    opts = {},
    config = function(_, opts)
      require('session-lens').setup(opts)
      require('telescope').load_extension 'session-lens'
    end,
  },

  -- Fuzzy Finder (files, lsp, etc)
  -- ref: https://github.com/nvim-telescope/telescope.nvim
  {
    'nvim-telescope/telescope.nvim',
    name = 'telescope',
    -- commit = '4d4ade7', -- pinned until `autocmd` feature is fixed in the next version
    cmd = { 'Telescope' },
    keys = {
      -- [[ Menus ]]
      { '<C-S-b>', '<cmd>Telescope builtin<CR>', desc = 'Search: Builtin Pickers' },
      { '<C-S-h>', '<cmd>Telescope help_tags<CR>', desc = 'Search: Help Pages' },
      { '<C-S-m>', '<cmd>Telescope man_pages<CR>', desc = 'Search: Man Pages' },
      { '<C-S-;>', '<cmd>Telescope commands<CR>', desc = 'Search: Plugin Commands' },

      -- [[ NVim settings ]]
      { '<C-,>c', '<cmd>Telescope colorscheme<CR>', desc = 'Settings: Colorscheme' },
      { '<C-,><C-c>', '<cmd>Telescope colorscheme<CR>', desc = 'Settings: Colorscheme' },
      { '<C-,>o', '<cmd>Telescope vim_options<CR>', desc = 'Settings: Vim Options' },
      { '<C-,><C-o>', '<cmd>Telescope vim_options<CR>', desc = 'Settings: Vim Options' },
      { '<C-,>a', '<cmd>Telescope autocommands<CR>', desc = 'Settings: Autocommands' },
      { '<C-,><C-a>', '<cmd>Telescope autocommands<CR>', desc = 'Settings: Autocommands' },
      { '<C-,>k', '<cmd>Telescope keymaps<CR>', desc = 'Settings: Keymappings' },
      { '<C-,><C-k>', '<cmd>Telescope keymaps<CR>', desc = 'Settings: Keymappings' },
      { '<C-,>h', '<cmd>Telescope highlights<CR>', desc = 'Settings: Highlights' },
      { '<C-,><C-h>', '<cmd>Telescope highlights<CR>', desc = 'Settings: Highlights' },
      { '<C-,>,', custom_pickers.find_chezmoi_files, desc = 'Settings: Dot Files' },
      { '<C-,><C-,>', custom_pickers.find_chezmoi_files, desc = 'Settings: Dot Files' },

      -- [[ Histories ]]
      { '<leader>|', '<cmd>Telescope oldfiles<CR>', desc = 'Search: Buffer History' },
      { '<leader>?', '<cmd>Telescope search_history<CR>', desc = 'Search: Search History' },
      { '<leader>:', '<cmd>Telescope command_history<CR>', desc = 'Search: Command History' },

      -- [[ Navigation ]]
      { '<leader><leader>', '<cmd>Telescope resume<CR>', desc = 'Picker: Resume Last' },
      { '<leader>\\', '<cmd>Telescope buffers<CR>', desc = 'Buffer: List Open' },
      { '<leader>p', custom_pickers.find_files, desc = 'Explorer: List Files' },

      -- [[ Full-text search ]]
      { '<leader>*', '<cmd>Telescope grep_string<CR>', desc = 'Search: Workspace <cword>' },
      { '<leader>*', '<cmd>Telescope grep_string<CR>', desc = 'Search: Workspace Current Highlighted', mode = 'x' },
      { '<leader>/', custom_pickers.local_fuzzy_find, desc = 'Search: Current Buffer' },
      { '<leader>f', custom_pickers.workspace_fuzzy_find, desc = 'Search: Current Workspace' },

      -- [[ Git Integration ]]
      { '<leader>gb', '<cmd>Telescope git_branches<CR>', desc = 'Git: Manage Branches' },
    },
    dependencies = { 'plenary', 'web-devicons', 'nvim-treesitter' },
    config = function()
      local telescope = require 'telescope'
      local actions = require 'telescope.actions'

      local custom_actions = require 'lazy-nvim.lib.telescope-actions'

      telescope.setup {
        defaults = {
          -- don't cycle results when scrolling past the last/first item
          -- scroll_strategy = 'limit',

          -- determine where should the selection starts (top/bottom)
          -- values: 'descending' | 'ascending'
          sorting_strategy = 'ascending',

          layout_strategy = 'vertical',
          layout_config = {
            vertical = {
              prompt_position = 'top',
              mirror = true,
              width = { 0.8, max = 90 },
              height = { 0.8, max = 37 },
              preview_height = { 0, min = 20 },
            },
          },

          -- these args will be used for `live_grep` and `grep_string`
          vimgrep_arguments = {
            'rg',
            '--color=never',
            '--no-heading',
            '--with-filename',
            '--line-number',
            '--column',
            '--smart-case',

            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
            '--hidden',

            -- Exclude some search results in these files
            '--glob',
            '!**/.git/*',
            '--glob',
            '!**/pnpm-lock.yaml',
            '--glob',
            '!**/yarn.lock',
            '--glob',
            '!**/package-lock.json',

            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#ripgrep-remove-indentation
            -- '--trim',
          },

          mappings = {
            i = {
              ['<C-c>'] = false,
              ['<C-f>'] = false,
              ['<C-n>'] = false,
              ['<C-p>'] = false,
              ['<C-r><C-w>'] = false,
              ['<C-x>'] = false,
              ['<M-f>'] = false,
              ['<S-Tab>'] = false,

              -- close prompt with these instead of <C-c>
              ['<ESC>'] = actions.close,
              ['<C-q>'] = actions.close,

              -- result scrolling
              ['<C-j>'] = actions.move_selection_next,
              ['<C-k>'] = actions.move_selection_previous,
              ['<C-h>'] = actions.results_scrolling_left,
              ['<C-l>'] = actions.results_scrolling_right,
              ['<C-d>'] = actions.results_scrolling_down,
              ['<C-u>'] = actions.results_scrolling_up,

              -- preview scrolling
              ['<M-j>'] = custom_actions.preview_scrolling_next,
              ['<M-k>'] = custom_actions.preview_scrolling_previous,
              ['<M-h>'] = actions.preview_scrolling_left,
              ['<M-l>'] = actions.preview_scrolling_right,
              ['<M-d>'] = actions.preview_scrolling_down,
              ['<M-u>'] = actions.preview_scrolling_up,

              -- remap <Tab> key to just only select result
              ['<Tab>'] = actions.toggle_selection,

              -- open all selected results in tabs, splits, buffers
              ['<C-s>'] = custom_actions.select_horizontal_or_multi,
              ['<C-v>'] = custom_actions.select_vertical_or_multi,
              ['<C-t>'] = custom_actions.select_tab_or_multi,

              -- cycle through Git previewers
              -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#mapping-c-sc-a-to-cycle-previewer-for-git-commits-to-show-full-message
              ['<C-S-left>'] = actions.cycle_previewers_prev,
              ['<C-S-right>'] = actions.cycle_previewers_next,
            },
          },
        },

        pickers = {
          help_tags = {
            mappings = {
              i = {
                ['<CR>'] = custom_actions.select_vertical_or_multi,
              },
            },
          },

          man_pages = {
            mappings = {
              i = {
                ['<CR>'] = custom_actions.select_vertical_or_multi,
              },
            },
          },

          colorscheme = {
            enable_preview = true,
          },

          grep_string = {
            path_display = { 'tail' },

            mappings = {
              i = {
                ['<CR>'] = actions.select_tab_drop,
                ['<S-CR>'] = actions.select_default,
              },
            },
          },

          find_files = {
            -- `hidden = true` will still show the inside of `.git/` as it's not specified in `.gitignore`.
            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
            find_command = {
              'fd',
              '--type',
              'file',
              '--hidden', -- to show dot files and folders
              '--exclude',
              '**/.git/*',
            },

            mappings = {
              i = {
                ['<CR>'] = actions.select_tab_drop,
                ['<S-CR>'] = actions.select_default,

                ['<M-r>'] = custom_actions.reveal_in_nvim_tree,
              },
            },
          },

          oldfiles = {
            mappings = {
              i = {
                ['<CR>'] = actions.select_tab_drop,
                ['<S-CR>'] = actions.select_default,
              },
            },
          },

          buffers = {
            ignore_current_buffer = true,
            sort_lastused = true,

            mappings = {
              i = {
                ['<CR>'] = actions.select_tab_drop,
                ['<S-CR>'] = actions.select_default,

                ['<C-c>'] = actions.delete_buffer,
              },
            },
          },

          lsp_definitions = { jump_type = 'tab drop', reuse_win = true },
          lsp_type_definitions = { jump_type = 'tab drop', reuse_win = true },
          lsp_implementations = { jump_type = 'tab drop', reuse_win = true },

          lsp_references = {
            jump_type = 'tab drop',
            include_declaration = false,
            include_current_line = true,
          },

          lsp_document_symbols = {
            mappings = {
              i = {
                ['<C-Space>'] = actions.complete_tag,
              },
            },
          },

          lsp_dynamic_workspace_symbols = {
            mappings = {
              i = {
                ['<CR>'] = actions.select_tab_drop,
                ['<S-CR>'] = actions.select_default,

                ['<C-Space>'] = actions.complete_tag,
              },
            },
          },
        },
      }

      -- Enable Telescope extensions if they are installed
      telescope.load_extension 'fzf'

      -- Custom Telescope auto commands
      require 'lazy-nvim.lib.telescope-autocmd'
    end,
  },
}
