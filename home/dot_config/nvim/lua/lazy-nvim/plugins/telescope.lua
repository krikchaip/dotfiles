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

  -- Telescope UI selecter extension
  {
    'nvim-telescope/telescope-ui-select.nvim',
    name = 'telescope.ui-select',
  },

  -- Telescope merge conflicts picker
  {
    'Snikimonkd/telescope-git-conflicts.nvim',
    name = 'telescope.conflicts',
  },

  -- Telescope LuaSnip snippets picker
  {
    'benfowler/telescope-luasnip.nvim',
    name = 'telescope.luasnip',
    keys = {
      { '<leader>sl', '<cmd>Telescope luasnip<CR>', desc = '[S]earch [L]uaSnip Snippets' },
      { '<C-\\>', '<cmd>Telescope luasnip<CR>', desc = 'Search LuaSnip Snippets', mode = 'i' },
    },
    dependencies = { 'luasnip', 'telescope' },
    config = function() require('telescope').load_extension 'luasnip' end,
  },

  -- Telescope session lens picker
  {
    'rmagatti/session-lens',
    name = 'telescope.session-lens',
    keys = {
      { '<leader>ss', '<cmd>SearchSession<CR>', desc = '[S]ession [S]earch' },
    },
    dependencies = { 'auto-session', 'telescope' },
    opts = {},
    config = function(_, opts) require('session-lens').setup(opts) end,
  },

  -- Fuzzy Finder (files, lsp, etc)
  -- ref: https://github.com/nvim-telescope/telescope.nvim
  {
    'nvim-telescope/telescope.nvim',
    name = 'telescope',
    -- branch = '0.1.x',
    commit = '4d4ade7', -- pinned until `autocmd` feature is fixed in the next version
    keys = {
      -- [[ Documentations ]]
      { '<C-S-h>', '<cmd>Telescope help_tags<CR>', desc = 'Search nvim help pages' },
      { '<C-S-m>', '<cmd>Telescope man_pages<CR>', desc = 'Search man pages' },

      -- [[ NVim settings ]]
      { '<C-,>c', '<cmd>Telescope colorscheme<CR>', desc = 'Change [c]olorscheme' },
      { '<C-,>o', '<cmd>Telescope vim_options<CR>', desc = 'Set nvim [o]ptions' },
      { '<C-,>a', '<cmd>Telescope autocommands<CR>', desc = 'List nvim [a]utocommands' },
      { '<C-,>k', '<cmd>Telescope keymaps<CR>', desc = 'List [k]eymappings' },
      { '<C-S-,>', custom_pickers.find_chezmoi_files, desc = 'Search Chezmoi files' },

      -- [[ Histories ]]
      { '<leader>|', '<cmd>Telescope oldfiles<CR>', desc = 'Buffer history' },
      { '<leader>?', '<cmd>Telescope search_history<CR>', desc = 'Search history' },
      { '<leader>:', '<cmd>Telescope command_history<CR>', desc = 'Command history' },

      -- [[ Navigation ]]
      { '<leader>\\', '<cmd>Telescope buffers<CR>', desc = 'Search open buffers' },
      { '<leader>a', '<cmd>Telescope builtin<CR>', desc = 'Search [a]ll pickers' },
      { '<leader><leader>', '<cmd>Telescope resume<CR>', desc = 'Resume last search' },

      -- [[ Explorer ]]
      { '<leader>es', custom_pickers.find_files, desc = '[S]earch Files' },

      -- [[ Menus ]]
      { '<C-S-;>', '<cmd>Telescope commands<CR>', desc = 'Search custom commands' },

      -- [[ Full-text search ]]
      { '<leader>*', '<cmd>Telescope grep_string<CR>', desc = 'Search current word in workspace', mode = { 'n', 'x' } },
      { '<leader>/', custom_pickers.local_fuzzy_find, desc = 'Fuzzily search in current buffer' },
      { '<C-S-f>', custom_pickers.workspace_fuzzy_find, desc = 'Search text in current workspace' },

      -- [[ Git Integration ]]
      { '<leader>gl', '<cmd>Telescope git_commits<CR>', desc = 'Show Git repo [l]ogs' },
      { '<leader>gf', '<cmd>Telescope git_bcommits<CR>', desc = 'Show [f]ile commits' },
      { '<leader>gb', '<cmd>Telescope git_branches<CR>', desc = 'Manage [b]ranches' },
      { '<leader>gs', '<cmd>Telescope git_status<CR>', desc = 'Show Git [s]tatus' },
      { '<leader>gt', '<cmd>Telescope git_stash<CR>', desc = 'List s[t]ash items' },
      { '<leader>gm', '<cmd>Telescope conflicts<CR>', desc = 'Show [m]erge conflicts' },
    },
    dependencies = { 'plenary', 'web-devicons', 'nvim-treesitter' },
    config = function()
      local telescope = require 'telescope'
      local actions = require 'telescope.actions'
      local themes = require 'telescope.themes'

      local custom_actions = require 'lazy-nvim.lib.telescope-actions'

      telescope.setup {
        defaults = {
          -- don't cycle results when scrolling past the last/first item
          -- scroll_strategy = 'limit',

          -- flip prompt bar position and initial result highlight
          sorting_strategy = 'ascending',
          layout_strategy = 'horizontal',
          layout_config = {
            prompt_position = 'top',
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
            '--glob',
            '!**/.git/*',
            '--glob',
            '!**/pnpm-lock.yaml',
            '--glob',
            '!**/yarn.lock',
            '--glob',
            '!**/package-lock.json',

            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#ripgrep-remove-indentation
            '--trim',
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
              ['<CR>'] = custom_actions.select_one_or_multi,

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

          find_files = {
            -- `hidden = true` will still show the inside of `.git/` as it's not `.gitignore`.
            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
            find_command = { 'rg', '--files', '--hidden', '--glob', '!**/.git/*' },
          },

          buffers = {
            mappings = {
              i = {
                ['<C-c>'] = actions.delete_buffer,
              },
            },
          },

          git_status = {
            git_icons = {
              added = '+',
              changed = '~',
              copied = '>',
              deleted = '-',
              renamed = '➡',
              unmerged = '‡',
              untracked = '?',
            },
          },
        },

        extensions = {
          ['ui-select'] = { themes.get_dropdown() },
        },
      }

      -- Enable Telescope extensions if they are installed
      telescope.load_extension 'fzf'
      telescope.load_extension 'ui-select'
      telescope.load_extension 'conflicts'
      telescope.load_extension 'chezmoi'
      telescope.load_extension 'session-lens'

      -- Custom Telescope auto commands
      require 'lazy-nvim.lib.telescope-autocmd'
    end,
  },
}
