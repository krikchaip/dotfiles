-- NOTE: Plugins can specify dependencies.
--
-- The dependencies are proper plugin specifications as well - anything
-- you do for a plugin at the top level, you can do for a dependency.
--
-- Use the `dependencies` key to specify the dependencies of a particular plugin

return {
  { -- Fuzzy Finder (files, lsp, etc)
    -- Telescope is a fuzzy finder that comes with a lot of different things that
    -- it can fuzzy find! It's more than just a 'file finder', it can search
    -- many different aspects of Neovim, your workspace, LSP, and more!
    --
    -- The easiest way to use Telescope, is to start by doing something like:
    --  :Telescope help_tags
    --
    -- After running this command, a window will open up and you're able to
    -- type in the prompt window. You'll see a list of `help_tags` options and
    -- a corresponding preview of the help.
    --
    -- Two important keymaps to use while in Telescope are:
    --  - Insert mode: <c-/>
    --  - Normal mode: ?
    --
    -- This opens a window that shows you all of the keymaps for the current
    -- Telescope picker. This is really useful to discover what Telescope can
    -- do as well as how to actually do it!
    'nvim-telescope/telescope.nvim',
    branch = '0.1.x',
    dependencies = {
      'nvim-lua/plenary.nvim',

      { -- If encountering errors, see telescope-fzf-native README for installation instructions
        'nvim-telescope/telescope-fzf-native.nvim',

        -- `build` is used to run some command when the plugin is installed/updated.
        -- This is only run then, not every time Neovim starts up.
        build = 'make',

        -- `cond` is a condition used to determine whether this plugin should be
        -- installed and loaded.
        cond = function()
          return vim.fn.executable 'make' == 1
        end,
      },

      { -- Useful for getting pretty icons, but requires a Nerd Font.
        'nvim-tree/nvim-web-devicons',
        enabled = vim.g.have_nerd_font
      },

      'nvim-telescope/telescope-ui-select.nvim',
      'chezmoi-highlighter',
      'chezmoi-watcher',
    },
    config = function()
      local telescope = require 'telescope'
      local builtin = require 'telescope.builtin' -- See `:help telescope.builtin`
      local actions = require 'telescope.actions' -- See `:help telescope.actions`
      local actions_state = require 'telescope.actions.state'

      local custom_actions = {
        -- ref: https://github.com/nvim-telescope/telescope.nvim/issues/1048#issuecomment-1679797700
        select_tab_or_multi = function(prompt_bufnr)
          local picker = actions_state.get_current_picker(prompt_bufnr)
          local multi = picker:get_multi_selection()

          if not vim.tbl_isempty(multi) then
            actions.close(prompt_bufnr)

            for _, j in pairs(multi) do
              if j.path ~= nil and j.lnum ~= nil then
                vim.cmd(string.format('%s %s:%s', 'tabedit', j.path, j.lnum))
              elseif j.path ~= nil then
                vim.cmd(string.format('%s %s', 'tabedit', j.path))
              end
            end
          else
            actions.select_tab(prompt_bufnr)
          end
        end
      }

      -- See `:help telescope` and `:help telescope.setup()`
      telescope.setup {
        defaults = {
          mappings = {
            i = {
              -- ['<C-CR>'] = 'to_fuzzy_refine'
              ['<ESC>'] = actions.close,                      -- completely disable normal mode on telescope prompt
              ['<S-CR>'] = custom_actions.select_tab_or_multi -- open selected items in new tabs
            }
          }
        },

        pickers = {
          help_tags = {
            mappings = {
              i = {
                ['<CR>'] = actions.select_vertical
              }
            }
          },

          man_pages = {
            mappings = {
              i = {
                ['<CR>'] = actions.select_vertical
              }
            }
          },

          colorscheme = {
            enable_preview = true
          }
        },

        extensions = {
          ['ui-select'] = { require('telescope.themes').get_dropdown() }
        }
      }

      -- Enable Telescope extensions if they are installed
      telescope.load_extension 'fzf'
      telescope.load_extension 'ui-select'
      telescope.load_extension 'chezmoi'

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
        telescope.extensions.chezmoi.find_files { path_display = { 'smart' } }
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
      vim.keymap.set('n', '<leader>ef', builtin.find_files, { desc = '[e]xplorer find [f]iles' })

      -- [[ Menus ]]
      vim.keymap.set('n', '<C-S-;>', builtin.commands, { desc = 'Search custom commands' })

      -- [[ Full-text search ]]
      -- vim.keymap.set('n', '<leader>sw', builtin.grep_string, { desc = '[S]earch current [W]ord' })
      -- vim.keymap.set('n', '<leader>sg', builtin.live_grep, { desc = '[S]earch by [G]rep' })

      -- Slightly advanced example of overriding default behavior and theme
      -- vim.keymap.set('n', '<leader>/', function()
      --   -- You can pass additional configuration to Telescope to change the theme, layout, etc.
      --   builtin.current_buffer_fuzzy_find(require('telescope.themes').get_dropdown {
      --     winblend = 10,
      --     previewer = false,
      --   })
      -- end, { desc = '[/] Fuzzily search in current buffer' })

      -- It's also possible to pass additional configuration options.
      --  See `:help telescope.builtin.live_grep()` for information about particular keys
      -- vim.keymap.set('n', '<leader>s/', function()
      --   builtin.live_grep {
      --     grep_open_files = true,
      --     prompt_title = 'Live Grep in Open Files',
      --   }
      -- end, { desc = '[S]earch [/] in Open Files' })
    end,
  },
}