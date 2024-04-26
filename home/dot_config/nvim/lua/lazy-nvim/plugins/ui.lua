return {
  -- Useful plugin to show you pending keybinds.
  -- ref: https://github.com/folke/which-key.nvim
  {
    'folke/which-key.nvim',
    name = 'which-key',
    event = 'VeryLazy',
    config = function()
      local which_key = require 'which-key'

      which_key.setup {
        icons = {
          breadcrumb = '»', -- symbol used in the command line area that shows your active key combo
          separator = '>',  -- symbol used between a key and it's label
          group = '+',      -- symbol prepended to a group
        },
      }

      -- Document existing key chains
      -- see: https://github.com/folke/which-key.nvim?tab=readme-ov-file#-setup
      which_key.register {
        ['<C-,>']      = { name = 'Nvim Settings', _ = 'which_key_ignore' },
        ['<leader>']   = { name = 'Special', _ = 'which_key_ignore' },
        ['<leader>e']  = { name = 'Explorer', _ = 'which_key_ignore' },
        ['<leader>g']  = { name = 'Git', _ = 'which_key_ignore' },
        ['<leader>gc'] = { name = 'Git Change', _ = 'which_key_ignore' },
        ['<leader>l']  = { name = 'LSP', _ = 'which_key_ignore' },
        ['<leader>s']  = { name = 'Swap', _ = 'which_key_ignore' },
        ['<leader>t']  = { name = 'Tab', _ = 'which_key_ignore' },
      }

      which_key.register({
        ['<leader>g']  = { name = 'Git', _ = 'which_key_ignore' },
        ['<leader>gc'] = { name = 'Git Change', _ = 'which_key_ignore' },
      }, { mode = 'x' })
    end,
  },

  {
    'petertriho/nvim-scrollbar',
    name = 'scrollbar',
    event = { 'BufReadPre', 'BufNewFile' },
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
    name = 'hlslens',
    keys = { '/', '?' },
    config = function()
      require('scrollbar.handlers.search').setup {
        virt_priority = 100,
      }

      local opts = { noremap = true, silent = true }

      opts.desc = 'Jump to the next match'
      vim.api.nvim_set_keymap('n', 'n',
        [[<Cmd>execute('normal! ' . v:count1 . 'n')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the previous match'
      vim.api.nvim_set_keymap('n', 'N',
        [[<Cmd>execute('normal! ' . v:count1 . 'N')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the next match under cursor'
      vim.api.nvim_set_keymap('n', '*', [[*<Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the previous match under cursor'
      vim.api.nvim_set_keymap('n', '#', [[#<Cmd>lua require('hlslens').start()<CR>]], opts)

      -- vim.api.nvim_set_keymap('n', 'g*', [[g*<Cmd>lua require('hlslens').start()<CR>]], opts)
      -- vim.api.nvim_set_keymap('n', 'g#', [[g#<Cmd>lua require('hlslens').start()<CR>]], opts)
    end
  },

  -- context sticky scroll
  -- ref: https://github.com/nvim-treesitter/nvim-treesitter-context
  {
    'nvim-treesitter/nvim-treesitter-context',
    name = 'treesitter-context',
    event = { 'BufReadPre', 'BufNewFile' },
    opts = {
      enable = true,
      -- max_lines = 3,           -- How many lines the window should span. Values <= 0 mean no limit.
      multiline_threshold = 1, -- Maximum number of lines to show for a single context
    },
    config = function(_, opts)
      local ts_context = require 'treesitter-context'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      ts_context.setup(opts)

      local _, ctx_upward = ts_repeat_move.make_repeatable_move_pair(
        function() end,
        function() ts_context.go_to_context(vim.v.count1) end
      )

      vim.keymap.set('n', '[C', ctx_upward, { desc = 'Jump to [C]ontext upwards' })
    end
  },

  -- Enable super zen mode by dims inactive portions of the code 👍🏻
  -- ref: https://github.com/folke/twilight.nvim
  {
    'folke/twilight.nvim',
    name = 'twilight',
    keys = {
      { '<leader>z', '<cmd>Twilight<CR>', desc = 'Toggle [z]en mode 🧘🏼' }
    },
    config = function()
      require('twilight').setup {
        dimming = {
          -- when true, other windows will be fully dimmed (unless they contain the same buffer)
          inactive = false,
        },

        -- amount of lines we will try to show around the current line
        context = 10,
      }
    end
  },

  -- Make Nvim's fold look much prettier & modern
  -- ref: https://github.com/kevinhwang91/nvim-ufo
  {
    'kevinhwang91/nvim-ufo',
    name = 'ufo',
    event = 'LspAttach', -- Important! otherwise it won't work
    dependencies = { 'promise-async' },
    opts = {},
    config = function(_, opts)
      require('ufo').setup(opts)
    end
  }
}
