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
  }
}
