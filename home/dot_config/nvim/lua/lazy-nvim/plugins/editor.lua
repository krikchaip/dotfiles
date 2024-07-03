local auto_session_utils = require 'lazy-nvim.lib.auto-session-utils'
local nvim_tree_utils = require 'lazy-nvim.lib.nvim-tree-utils'
local window_picker_utils = require 'lazy-nvim.lib.window-picker-utils'

return {
  -- Detect tabstop and shiftwidth automatically
  {
    'tpope/vim-sleuth',
    name = 'vim-sleuth',
    event = { 'BufReadPre', 'BufNewFile' },
  },

  -- A better :bdelete and :bwipeout that doesn't destroy your windows/tabs layout
  {
    'moll/vim-bbye',
    name = 'bbye',
    cmd = { 'Bdelete', 'Bwipeout' },
    keys = {
      { '<leader>x', '<cmd>Bdelete<CR>', desc = 'Buffer: Delete Current (Preserve Window)' },
      { '<leader>X', '<cmd>Bdelete!<CR>', desc = 'Buffer: Force Delete Current (Preserve Window)' },
    },
  },

  -- Automatically save/restore nvim session, including buffers, window layouts and tabs
  {
    'rmagatti/auto-session',
    name = 'auto-session',
    cmd = {
      'SessionSave',
      'SessionRestore',
      'SessionDelete',
      'SessionPurgeOrphaned',
      'Autosession',
    },
    keys = {
      { '<leader>s', '<cmd>Telescope session-lens<CR>', desc = 'Session: Open Session Lens' },
    },
    opts = {
      -- Enables/disables the plugin's auto save and restore features
      auto_session_enabled = false,

      -- Enables/disables the plugin's session auto creation
      auto_session_create_enabled = false,

      -- Enables/disables auto saving
      auto_save_enabled = false,

      -- Enables/disables auto restoring
      auto_restore_enabled = false,

      -- Use the git branch to differentiate the session name
      auto_session_use_git_branch = false,

      -- Bypass auto save when only buffer open is one of these file types
      bypass_session_save_file_types = nil,

      -- Config for handling the DirChangePre and DirChanged autocmds
      cwd_change_handling = nil,

      pre_save_cmds = {
        nvim_tree_utils.close_all_nvim_tree,
      },

      post_restore_cmds = {
        -- Restore nvim-tree if possible after restoring another buffers
        -- nvim_tree_utils.restore_nvim_tree,
      },

      -- custom session lens config (telescope)
      session_lens = auto_session_utils.session_lens_config,
    },
    init = function()
      vim.opt.sessionoptions = {
        -- When restoring plugin help pages (eg. telescope), it also requires the plugin to be loaded first.
        -- Therefore, if the plugin is lazy loaded while having your session containing its help page.
        -- There will be times that restoring the session might fail.
        -- 'help',

        -- 'blank',
        'buffers',
        'curdir',
        'folds',
        'globals',
        'tabpages',
        'terminal',
        'winpos',
        'winsize',
      }
    end,
    config = function(_, opts)
      require('auto-session').setup(opts)

      require('lazy-nvim.lib.auto-session-utils').setup_autosave_session()
      require('lazy-nvim.lib.auto-session-utils').setup_dirchanged_session()
    end,
  },

  -- A minimalist auto brackets closer
  -- ref: https://github.com/m4xshen/autoclose.nvim
  -- {
  --   'm4xshen/autoclose.nvim',
  --   name = 'autoclose',
  --   event = { 'InsertEnter', 'CmdlineEnter' },
  --   opts = {},
  -- },

  -- A super powerful autopair plugin that supports multiple characters
  -- ref: https://github.com/windwp/nvim-autopairs
  {
    'windwp/nvim-autopairs',
    name = 'autopairs',
    event = 'InsertEnter',
    opts = {
      disable_filetype = {},
      disable_in_visualblock = false, -- disable when insert after visual block mode
      enable_afterquote = true, -- add bracket pairs after quote
      break_undo = true, -- switch for basic rule break undo sequence
      check_ts = true, -- use treesitter to check for a pair
    },
  },

  -- Making Comment.nvim understands jsx, vue, markdown and etc.
  -- ref: https://github.com/JoosepAlviste/nvim-ts-context-commentstring
  {
    'JoosepAlviste/nvim-ts-context-commentstring',
    name = 'ts-context-commentstring',
    init = function()
      -- skip backwards compatibility routines and speed up loading
      vim.g.skip_ts_context_commentstring_module = true
    end,
  },

  -- [[ Linewise ]]
  --   `gc` - (Visual mode) Toggles the region using linewise comment
  --   `gcc` - (Normal mode) Toggles the current line using linewise comment
  --   `[count]gcc` - Toggles the number of line given as a prefix-count using linewise
  --   `gc[count]{motion}` - (Op-pending) Toggles the region using linewise comment
  --   `gco` - Insert comment to the next line and enters INSERT mode
  --   `gcO` - Insert comment to the previous line and enters INSERT mode
  --   `gcA` - Insert comment to end of the current line and enters INSERT mode
  --   `gcw` - Toggle from the current cursor position to the next word
  --   `gc$` - Toggle from the current cursor position to the end of line
  --   `gc}` - Toggle until the next blank line
  --   `gc5j` - Toggle 5 lines after the current cursor position
  --   `gc8k` - Toggle 8 lines before the current cursor position
  --   `gcip` - Toggle inside of paragraph
  --   `gca}` - Toggle around curly brackets
  --
  -- [[ Blockwise ]]
  --   `gb` - (Visual mode) Toggles the region using blockwise comment
  --   `gbc` - (Normal mode) Toggles the current line using blockwise comment
  --   `[count]gbc` - Toggles the number of line given as a prefix-count using blockwise
  --   `gb[count]{motion}` - (Op-pending) Toggles the region using blockwise comment
  --   `gb2}` - Toggle until the 2 next blank line
  --   `gbaf` - Toggle comment around a function (w/ LSP/treesitter support)
  --   `gbac` - Toggle comment around a class (w/ LSP/treesitter support)
  {
    'numToStr/Comment.nvim',
    name = 'comment',
    keys = {
      { 'gc', desc = 'Comment: Linewise ...' },
      { 'gb', desc = 'Comment: Blockwise ...' },

      {
        '<M-/>',
        function()
          local api = require 'Comment.api'
          local config = require('Comment.config'):get()

          if vim.fn.mode() == 'n' then return api.insert.linewise.eol(config) end

          -- (assuming insert mode) stop insert mode before executing the command
          vim.cmd 'stopinsert'

          -- doesn't add <Space> to the end
          api.insert.linewise.eol(config)

          -- so we need to add <Space> character manually
          local space = vim.api.nvim_replace_termcodes('<Space>', true, false, true)
          vim.api.nvim_feedkeys(space, 'n', false)
        end,
        desc = 'Comment: Insert Linewise at EOL',
        mode = { 'n', 'i' },
      },

      {
        '<C-/>',
        function()
          local api = require 'Comment.api'
          local config = require('Comment.config'):get()

          api.toggle.linewise.current(config)
        end,
        desc = 'Comment: Toggle Linewise Current Line',
        mode = { 'n', 'i' },
      },
      {
        '<C-S-/>',
        function()
          local api = require 'Comment.api'
          local config = require('Comment.config'):get()

          api.toggle.blockwise.current(config)
        end,
        desc = 'Comment: Toggle Blockwise Current Line',
        mode = { 'n', 'i' },
      },

      {
        '<C-/>',
        '<Plug>(comment_toggle_linewise_visual)',
        desc = 'Comment: Toggle Linewise Highlighted',
        mode = 'x',
      },
      {
        '<C-S-/>',
        '<Plug>(comment_toggle_blockwise_visual)',
        desc = 'Comment: Toggle Blockwise Highlighted',
        mode = 'x',
      },
    },
    config = function()
      require('Comment').setup {
        -- integrate with nvim-ts-context-commentstring
        pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
      }
    end,
  },

  -- [[ Add Surround ]]
  --   `ysiw)` - surr*ound_words         -> (surround_words)
  --   `ysa")` - require"nvim-surroun*d" -> require("nvim-surround")
  --   `ys$"`  - *make strings           -> "make strings"
  --   `ysl'`  - char c = *x;            -> char c = 'x';
  --   `yst;}` - int a[] = *32;          -> int a[] = {32};
  --
  -- [[ Delete Surround ]]
  --   `ds]` - [delete ar*ound me!]     -> delete around me!
  --   `dst` - remove <b>HTML t*ags</b> -> remove HTML tags
  --   `dsf` - delete(functi*on calls)  -> function calls
  --
  -- [[ Change Surround ]]
  --   `cs'"`      - 'change quot*es'     -> "change quotes"
  --   `csth1<CR>` - <b>or tag* types</b> -> <h1>or tag types</h1>
  --
  -- [[ Aliases ]]
  --   `b` - (Parentheses)
  --   `B` - {Curly Brackets}
  --   `r` - [Square Brackets]
  --   `q` - `"'Quotes'"`
  --   `a` - <Anchors>
  --
  -- Note: Tabular aliases cannot be used to add surrounding pairs,
  -- e.g. `ysa)q` is invalid, since it's ambiguous which pair should be added.
  {
    'kylechui/nvim-surround',
    name = 'surround',
    version = '*', -- use for stability; omit to use `main` branch for the latest features
    event = 'VeryLazy',
    opts = {
      -- keep the cursor position after performing a surround action
      move_cursor = false,

      keymaps = {
        insert = '<C-g>',
        insert_line = '<C-Enter>',
      },
    },
  },

  {
    'sindrets/winshift.nvim',
    name = 'winshift',
    keys = {
      { '<C-w><C-m>', '<Cmd>WinShift<CR>', desc = 'Window: Start Win-Move Mode' },
      { '<C-w>m', '<Cmd>WinShift<CR>', desc = 'Window: Start Win-Move Mode' },

      { '<C-w><C-x>', '<Cmd>WinShift swap<CR>', desc = 'Window: Swap Current With Selection' },
      { '<C-w>x', '<Cmd>WinShift swap<CR>', desc = 'Window: Swap Current With Selection' },

      { '<C-w><C-h>', '<Cmd>WinShift left<CR>', desc = 'Window: Move Current Leftward' },
      { '<C-w>h', '<Cmd>WinShift left<CR>', desc = 'Window: Move Current Leftward' },

      { '<C-w><C-j>', '<Cmd>WinShift down<CR>', desc = 'Window: Move Current Downward' },
      { '<C-w>j', '<Cmd>WinShift down<CR>', desc = 'Window: Move Current Downward' },

      { '<C-w><C-k>', '<Cmd>WinShift up<CR>', desc = 'Window: Move Current Upward' },
      { '<C-w>k', '<Cmd>WinShift up<CR>', desc = 'Window: Move Current Upward' },

      { '<C-w><C-l>', '<Cmd>WinShift right<CR>', desc = 'Window: Move Current Rightward' },
      { '<C-w>l', '<Cmd>WinShift right<CR>', desc = 'Window: Move Current Rightward' },
    },
    opts = {
      -- a function that should prompt the user to select a window to be swapped.
      window_picker = function()
        return require('window-picker').pick_window()
      end,
    },
  },

  {
    's1n7ax/nvim-window-picker',
    name = 'window-picker',
    version = '2.*',
    keys = {
      { '<C-w><C-w>', window_picker_utils.pick_window, desc = 'Window: Switch to Selection' },
      { '<C-w>w', window_picker_utils.pick_window, desc = 'Window: Switch to Selection' },
    },
    opts = {
      -- available options: 'statusline-winbar' | 'floating-big-letter'
      hint = 'floating-big-letter',

      -- whether to show 'Pick window:' prompt
      show_prompt = false,

      -- when you go to window selection mode, status bar will show one of
      -- following letters on them so you can use that letter to select the window
      selection_chars = 'JKLIMOP',

      -- exclude buffers/windows with the following options
      filter_rules = {
        bo = {
          filetype = { 'fidget', 'noice' },
        },

        wo = {
          winhl = { 'NormalFloat:TreesitterContext', 'NormalFloat:TreesitterContextLineNumber' },
        },
      },
    },
  },

  {
    'norcalli/nvim-colorizer.lua',
    name = 'colorizer',
    lazy = false,
    config = function()
      local webdev_options = {
        rgb_fn = true, -- CSS rgb() and rgba() functions
        hsl_fn = true, -- CSS hsl() and hsla() functions
        css = true, -- Enable all CSS features: rgb_fn, hsl_fn, names, RGB, RRGGBB
        css_fn = true, -- Enable all CSS *functions*: rgb_fn, hsl_fn
      }

      require('colorizer').setup({
        '*',
        html = webdev_options,
        css = webdev_options,
        javascript = webdev_options,
        javascriptreact = webdev_options,
        typescript = webdev_options,
        typescriptreact = webdev_options,
      }, {
        RRGGBBAA = true, -- #RRGGBBAA hex codes
      })
    end,
  },

  {
    'RRethy/vim-illuminate',
    name = 'illuminate',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      require('illuminate').configure {
        -- delay in milliseconds
        delay = 500,

        -- filetypes to not illuminate, this overrides filetypes_allowlist
        filetypes_denylist = {
          'DiffviewFileHistory',
          'DiffviewFiles',
          'DressingInput',
          'Navbuddy',
          'NvimTree',
          'TelescopePrompt',
          'TelescopeResults',
          'cmp_docs',
          'cmp_menu',
          'dashboard',
          'lazy',
          'noice',
        },

        -- number of lines at which to use large_file_config
        -- The `under_cursor` option is disabled when this cutoff is hit
        large_file_cutoff = 2500,

        -- case_insensitive_regex: sets regex case sensitivity
        case_insensitive_regex = false,
      }

      vim.cmd [[hi! default link IlluminatedWordText LspReferenceText]]
      vim.cmd [[hi! default link IlluminatedWordRead LspReferenceRead]]
      vim.cmd [[hi! default link IlluminatedWordWrite LspReferenceWrite]]
    end,
  },

  {
    'lukas-reineke/headlines.nvim',
    name = 'headlines',
    ft = { 'markdown' },
    opts = {},
  },
}
