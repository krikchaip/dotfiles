local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

return {
  -- Help improve Telescope sorting performance
  {
    'nvim-telescope/telescope-fzf-native.nvim',
    name = 'telescope.fzf',
    build = 'make',   -- run only when the plugin is installed/updated
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

  -- Fuzzy Finder (files, lsp, etc)
  -- ref: https://github.com/nvim-telescope/telescope.nvim
  {
    'nvim-telescope/telescope.nvim',
    name = 'telescope',
    -- branch = '0.1.x',
    commit = '4d4ade7', -- pinned until `autocmd` feature is fixed in the next version
    keys = {
      -- [[ Documentations ]]
      { '<C-S-h>', '<cmd>Telescope help_tags<CR>',    desc = 'Search nvim help pages' },
      { '<C-S-m>', '<cmd>Telescope man_pages<CR>',    desc = 'Search man pages' },

      -- [[ NVim settings ]]
      { '<C-,>c',  '<cmd>Telescope colorscheme<CR>',  desc = 'Change [c]olorscheme' },
      { '<C-,>o',  '<cmd>Telescope vim_options<CR>',  desc = 'Set nvim [o]ptions' },
      { '<C-,>a',  '<cmd>Telescope autocommands<CR>', desc = 'List nvim [a]utocommands' },
      { '<C-,>k',  '<cmd>Telescope keymaps<CR>',      desc = 'List [k]eymappings' },

      -- Shortcut for searching your Chezmoi files
      {
        '<C-S-,>',
        function()
          -- NOTE: this is somehow doesn't work
          -- telescope.extensions.chezmoi.find_files {}

          require('telescope.builtin').find_files {
            prompt_title = 'Chezmoi files',
            cwd = os.getenv('HOME') .. '/.local/share/chezmoi'
          }
        end,
        desc = 'Search Chezmoi files'
      },

      -- [[ Histories ]]
      { '<leader>|',        '<cmd>Telescope oldfiles<CR>',        desc = 'Buffer history' },
      { '<leader>?',        '<cmd>Telescope search_history<CR>',  desc = 'Search history' },
      { '<leader>:',        '<cmd>Telescope command_history<CR>', desc = 'Command history' },

      -- [[ Navigation ]]
      { '<leader>\\',       '<cmd>Telescope buffers<CR>',         desc = 'Search open buffers' },
      { '<leader>a',        '<cmd>Telescope builtin<CR>',         desc = 'Search [a]ll pickers' },
      { '<leader><leader>', '<cmd>Telescope resume<CR>',          desc = 'Resume last search' },

      -- [[ Explorer ]]
      { '<leader>ef',       custom_pickers.find_files,            desc = '[e]xplorer find [f]iles' },

      -- [[ Menus ]]
      { '<C-S-;>',          '<cmd>Telescope commands<CR>',        desc = 'Search custom commands' },

      -- [[ Full-text search ]]
      {
        '<leader>*',
        '<cmd>Telescope grep_string<CR>',
        desc = 'Search current word in workspace',
        mode = { 'n', 'x' },
      },

      -- Search text within workspace using grep_string
      {
        '<C-S-f>',
        function()
          -- Live grep does not support fuzzy finding
          -- ref: https://www.reddit.com/r/neovim/comments/s696vk/telescope_fzf_ag_for_live_grep/
          require('telescope.builtin').grep_string {
            prompt_title = 'Search current workspace',
            search = '',
            only_sort_text = true
          }
        end,
        desc = 'Search text in current workspace',
        mode = { 'n', 'i' },
      },

      -- Fuzzy search within buffer
      { '<leader>/',  custom_pickers.local_fuzzy_find,   desc = 'Fuzzily search in current buffer', mode = 'n' },
      { '<C-f>',      custom_pickers.local_fuzzy_find,   desc = 'Fuzzily search in current buffer', mode = 'i' },

      -- [[ Git Integration ]]
      { '<leader>gl', '<cmd>Telescope git_commits<CR>',  desc = 'Show Git repo [l]ogs' },
      { '<leader>gf', '<cmd>Telescope git_bcommits<CR>', desc = 'Show [f]ile commits' },
      { '<leader>gb', '<cmd>Telescope git_branches<CR>', desc = 'Manage [b]ranches' },
      { '<leader>gs', '<cmd>Telescope git_status<CR>',   desc = 'Show Git [s]tatus' },
      { '<leader>gt', '<cmd>Telescope git_stash<CR>',    desc = 'List s[t]ash items' },
      { '<leader>gm', '<cmd>Telescope conflicts<CR>',    desc = 'Show [m]erge conflicts' },
    },
    dependencies = {
      'plenary',
      'web-devicons',

      'telescope.fzf',
      'telescope.ui-select',
      'telescope.conflicts',
      'chezmoi.file-watcher',
    },
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
            '--glob', '!**/.git/*',
            '--glob', '!**/pnpm-lock.yaml',
            '--glob', '!**/yarn.lock',
            '--glob', '!**/package-lock.json',

            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#ripgrep-remove-indentation
            '--trim',
          },

          mappings = {
            i = {
              ['<C-c>'] = false,
              ['<C-l>'] = false,
              ['<C-n>'] = false,
              ['<C-p>'] = false,
              ['<C-r><C-w>'] = false,
              ['<M-f>'] = false,
              ['<S-Tab>'] = false,

              -- close prompt with these instead of <C-c>
              ['<ESC>'] = actions.close,
              ['<C-q>'] = actions.close,

              -- preview horizontal scrolling (<C-d>, <C-u> for vertical)
              ['<C-f>'] = actions.preview_scrolling_right,
              ['<C-b>'] = actions.preview_scrolling_left,

              -- result scrolling alternatives
              ['<M-h>'] = actions.results_scrolling_left,
              ['<M-l>'] = actions.results_scrolling_right,
              ['<M-j>'] = actions.results_scrolling_down,
              ['<M-k>'] = actions.results_scrolling_up,

              -- move selection alternatives
              ['<C-j>'] = actions.move_selection_next,
              ['<C-k>'] = actions.move_selection_previous,

              -- remap <Tab> keys
              ['<Tab>'] = actions.toggle_selection,

              -- cycle through Git previewers
              -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#mapping-c-sc-a-to-cycle-previewer-for-git-commits-to-show-full-message
              ['<C-S-left>'] = actions.cycle_previewers_prev,
              ['<C-S-right>'] = actions.cycle_previewers_next,
            }
          }
        },

        pickers = {
          help_tags = {
            mappings = {
              i = {
                ['<C-v>'] = false,

                ['<CR>'] = actions.select_vertical,
                ['<S-CR>'] = actions.select_default,
              }
            }
          },

          man_pages = {
            mappings = {
              i = {
                ['<C-v>'] = false,

                ['<CR>'] = actions.select_vertical,
                ['<S-CR>'] = actions.select_default,
              }
            }
          },

          colorscheme = {
            enable_preview = true
          },

          find_files = {
            -- `hidden = true` will still show the inside of `.git/` as it's not `.gitignore`.
            -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
            find_command = { 'rg', '--files', '--hidden', '--glob', '!**/.git/*' },

            mappings = {
              i = {
                ['<C-t>'] = false,
                ['<S-CR>'] = custom_actions.select_tab_or_multi,
              }
            }
          },

          buffers = {
            mappings = {
              i = {
                ['<C-t>'] = false,

                ['<S-CR>'] = custom_actions.select_tab_or_multi,
                ['<C-c>'] = actions.delete_buffer,
              }
            }
          },

          oldfiles = {
            mappings = {
              i = {
                ['<C-t>'] = false,
                ['<S-CR>'] = custom_actions.select_tab_or_multi,
              }
            }
          },

          grep_string = {
            mappings = {
              i = {
                ['<C-t>'] = false,
                ['<S-CR>'] = custom_actions.select_tab_or_multi,
              }
            }
          },

          git_branches = {
            mappings = {
              i = {
                ['<C-d>'] = actions.preview_scrolling_down,
                ['<C-BS>'] = actions.git_delete_branch,
              }
            }
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

            mappings = {
              i = {
                ['<C-t>'] = false,
                ['<S-CR>'] = custom_actions.select_tab_or_multi,
              }
            }
          },
        },

        extensions = {
          ['ui-select'] = { themes.get_dropdown() },
        }
      }

      -- Enable Telescope extensions if they are installed
      telescope.load_extension 'fzf'
      telescope.load_extension 'ui-select'
      telescope.load_extension 'conflicts'
      telescope.load_extension 'chezmoi'

      -- Custom Telescope auto commands
      require 'lazy-nvim.lib.telescope-autocmd'
    end,
  },
}
