return {
  -- NOTE: Plugins can also be configured to run Lua code when they are loaded.
  --
  -- This is often very useful to both group configuration, as well as handle
  -- lazy loading plugins that don't need to be loaded immediately at startup.
  --
  -- For example, in the following configuration, we use:
  --  event = 'VimEnter'
  --
  -- which loads which-key before all the UI elements are loaded. Events can be
  -- normal autocommands events (`:help autocmd-events`).
  --
  -- Then, because we use the `config` key, the configuration only runs
  -- after the plugin has been loaded:
  --  config = function() ... end

  {
    'folke/which-key.nvim', -- Useful plugin to show you pending keybinds.
    event = 'VimEnter',     -- Sets the loading event to 'VimEnter'
    config = function()     -- This is the function that runs, AFTER loading
      require('which-key').setup {
        icons = {
          breadcrumb = '»', -- symbol used in the command line area that shows your active key combo
          separator = '>',  -- symbol used between a key and it's label
          group = '+',      -- symbol prepended to a group
        },
      }

      -- Document existing key chains
      -- see: https://github.com/folke/which-key.nvim?tab=readme-ov-file#-setup
      require('which-key').register {
        ['<C-,>']      = { name = 'Nvim Settings', _ = 'which_key_ignore' },
        ['<leader>']   = { name = 'Special', _ = 'which_key_ignore' },
        ['<leader>e']  = { name = 'Explorer', _ = 'which_key_ignore' },
        ['<leader>g']  = { name = 'Git', _ = 'which_key_ignore' },
        ['<leader>gc'] = { name = 'Git Change', _ = 'which_key_ignore' },
        ['<leader>s']  = { name = 'Swap', _ = 'which_key_ignore' },
        ['<leader>t']  = { name = 'Tab', _ = 'which_key_ignore' },
      }
    end,
  },

  {
    'petertriho/nvim-scrollbar',
    dependencies = { 'lewis6991/gitsigns.nvim', 'kevinhwang91/nvim-hlslens' },
    config = function()
      local colors = require('tokyonight.colors').setup()

      require('scrollbar').setup {
        -- excluded_buftypes = {
        --   'terminal',
        -- },

        -- excluded_filetypes = {
        --   'cmp_docs',
        --   'cmp_menu',
        --   'noice',
        --   'prompt',
        --   'TelescopePrompt',
        -- },

        handle = {
          blend = 10, -- 0 for fully opaque and 100 to full transparent
        },

        marks = {
          Search = { color = colors.orange },
          Error = { color = colors.error },
          Warn = { color = colors.warning },
          Info = { color = colors.info },
          Hint = { color = colors.hint },
          Misc = { color = colors.purple },
        },
      }
    end
  },

  {
    'kevinhwang91/nvim-hlslens',
    config = function()
      require('scrollbar.handlers.search').setup {
        virt_priority = 90,
      }

      local kopts = { noremap = true, silent = true }

      kopts.desc = 'Jump to the next match'
      vim.api.nvim_set_keymap('n', 'n',
        [[<Cmd>execute('normal! ' . v:count1 . 'n')<CR><Cmd>lua require('hlslens').start()<CR>]], kopts)

      kopts.desc = 'Jump to the previous match'
      vim.api.nvim_set_keymap('n', 'N',
        [[<Cmd>execute('normal! ' . v:count1 . 'N')<CR><Cmd>lua require('hlslens').start()<CR>]], kopts)

      kopts.desc = 'Jump to the next match under cursor'
      vim.api.nvim_set_keymap('n', '*', [[*<Cmd>lua require('hlslens').start()<CR>]], kopts)

      kopts.desc = 'Jump to the previous match under cursor'
      vim.api.nvim_set_keymap('n', '#', [[#<Cmd>lua require('hlslens').start()<CR>]], kopts)

      -- vim.api.nvim_set_keymap('n', 'g*', [[g*<Cmd>lua require('hlslens').start()<CR>]], kopts)
      -- vim.api.nvim_set_keymap('n', 'g#', [[g#<Cmd>lua require('hlslens').start()<CR>]], kopts)
    end
  },

  -- context sticky scroll
  -- ref: https://github.com/nvim-treesitter/nvim-treesitter-context
  {
    'nvim-treesitter/nvim-treesitter-context',
    dependencies = {
      'nvim-treesitter/nvim-treesitter-textobjects'
    },
    opts = {
      enable = true,
      -- max_lines = 3,           -- How many lines the window should span. Values <= 0 mean no limit.
      multiline_threshold = 1, -- Maximum number of lines to show for a single context
    },
    config = function(_, opts)
      local ts_context = require('treesitter-context')
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      ts_context.setup(opts)

      local ctx_upward_repeatable, _ = ts_repeat_move.make_repeatable_move_pair(
        function() ts_context.go_to_context(vim.v.count1) end,
        function() end
      )

      vim.keymap.set('n', '[C', ctx_upward_repeatable, { desc = 'Jump to [C]ontext upwards' })
    end
  },

  -- Enable super zen mode by dims inactive portions of the code 👍🏻
  -- ref: https://github.com/folke/twilight.nvim
  {
    'folke/twilight.nvim',
    config = function()
      require('twilight').setup {
        dimming = {
          -- when true, other windows will be fully dimmed (unless they contain the same buffer)
          inactive = false,
        },

        -- amount of lines we will try to show around the current line
        context = 10,
      }

      vim.keymap.set('n', '<leader>z', '<cmd>Twilight<CR>', { desc = 'Toggle [z]en mode 🧘🏼' })
    end
  }
}
