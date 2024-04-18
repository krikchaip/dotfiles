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
      local builtin = require 'telescope.builtin'
      local actions = require 'telescope.actions'
      local themes = require 'telescope.themes'

      local custom_actions = require 'lazy-nvim.lib.telescope-actions'
      local custom_pickers = require 'lazy-nvim.lib.telescope-pickers'

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

      -- [[ Documentations ]]
      vim.keymap.set('n', '<C-S-h>', builtin.help_tags, { desc = 'Search nvim help pages' })
      vim.keymap.set('n', '<C-S-m>', builtin.man_pages, { desc = 'Search man pages' })

      -- [[ NVim settings ]]
      vim.keymap.set('n', '<C-,>c', builtin.colorscheme, { desc = 'Change [c]olorscheme' })
      vim.keymap.set('n', '<C-,>o', builtin.vim_options, { desc = 'Set nvim [o]ptions' })
      vim.keymap.set('n', '<C-,>a', builtin.autocommands, { desc = 'List nvim [a]utocommands' })
      vim.keymap.set('n', '<C-,>k', builtin.keymaps, { desc = 'List [k]eymappings' })

      -- Shortcut for searching your Chezmoi files
      vim.keymap.set('n', '<C-S-,>', function()
        -- telescope.extensions.chezmoi.find_files {}
        builtin.find_files {
          prompt_title = 'Chezmoi files',
          cwd = os.getenv('HOME') .. '/.local/share/chezmoi'
        }
      end, { desc = 'Search Chezmoi files' })

      -- [[ Histories ]]
      vim.keymap.set('n', '<leader>|', builtin.oldfiles, { desc = 'Buffer history' })
      vim.keymap.set('n', '<leader>?', builtin.search_history, { desc = 'Search history' })
      vim.keymap.set('n', '<leader>:', builtin.command_history, { desc = 'Command history' })

      -- [[ Navigation ]]
      vim.keymap.set('n', '<leader>\\', builtin.buffers, { desc = 'Search open buffers' })
      vim.keymap.set('n', '<leader>a', builtin.builtin, { desc = 'Search [a]ll pickers' })
      vim.keymap.set('n', '<leader><leader>', builtin.resume, { desc = 'Resume last search' })

      -- [[ Explorer ]]
      vim.keymap.set('n', '<leader>ef', custom_pickers.find_files, { desc = '[e]xplorer find [f]iles' })

      -- [[ Menus ]]
      vim.keymap.set('n', '<C-S-;>', builtin.commands, { desc = 'Search custom commands' })

      -- [[ Full-text search ]]
      vim.keymap.set({ 'n', 'x' }, '<leader>*', builtin.grep_string, {
        desc = 'Search current word in workspace'
      })

      -- Search text within workspace using grep_string
      vim.keymap.set({ 'n', 'i' }, '<C-S-f>', function()
        -- Live grep does not support fuzzy finding
        -- ref: https://www.reddit.com/r/neovim/comments/s696vk/telescope_fzf_ag_for_live_grep/
        builtin.grep_string {
          prompt_title = 'Search current workspace',
          search = '',
          only_sort_text = true
        }
      end, { desc = 'Search text in current workspace' })

      -- Fuzzy search within buffer
      local function local_fuzzy_find()
        builtin.current_buffer_fuzzy_find(themes.get_dropdown {
          winblend = 10,
          previewer = false,
        })
      end

      vim.keymap.set('n', '<leader>/', local_fuzzy_find, { desc = 'Fuzzily search in current buffer' })
      vim.keymap.set('i', '<C-f>', local_fuzzy_find, { desc = 'Fuzzily search in current buffer' })

      -- [[ Git Integration ]]
      vim.keymap.set('n', '<leader>gl', builtin.git_commits, { desc = 'Show Git repo [l]ogs' })
      vim.keymap.set('n', '<leader>gf', builtin.git_bcommits, { desc = 'Show [f]ile commits' })
      vim.keymap.set('n', '<leader>gb', builtin.git_branches, { desc = 'Manage [b]ranches' })
      vim.keymap.set('n', '<leader>gs', builtin.git_status, { desc = 'Show Git [s]tatus' })
      vim.keymap.set('n', '<leader>gt', builtin.git_stash, { desc = 'List s[t]ash items' })
      vim.keymap.set('n', '<leader>gm', '<cmd>Telescope conflicts<CR>', { desc = 'Show [m]erge conflicts' })
    end,
  },
}
