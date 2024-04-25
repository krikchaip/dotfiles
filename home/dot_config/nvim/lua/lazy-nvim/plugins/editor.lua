return {
  -- Detect tabstop and shiftwidth automatically
  {
    'tpope/vim-sleuth',
    name = 'vim-sleuth',
    event = { 'BufReadPre', 'BufNewFile' },
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
    event = { 'InsertEnter' },
    opts = {
      disable_filetype       = {},
      disable_in_visualblock = false, -- disable when insert after visual block mode
      enable_afterquote      = true,  -- add bracket pairs after quote
      break_undo             = true,  -- switch for basic rule break undo sequence
      check_ts               = true,  -- use treesitter to check for a pair
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
    end
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
      { 'gc', desc = 'Comment toggle linewise' },
      { 'gb', desc = 'Comment toggle blockwise' },

      {
        '<C-/>',
        function() require('Comment.api').toggle.linewise.current() end,
        desc = 'Toggle comment on the current line [linewise]',
        mode = { 'n', 'i' },
      },
      {
        '<C-S-/>',
        function() require('Comment.api').toggle.blockwise.current() end,
        desc = 'Toggle comment on the current line [blockwise]',
        mode = { 'n', 'i' },
      },

      {
        '<C-/>',
        '<Plug>(comment_toggle_linewise_visual)',
        desc = 'Toggle comment on the selected region [linewise]',
        mode = 'x'
      },
      {
        '<C-S-/>',
        '<Plug>(comment_toggle_blockwise_visual)',
        desc = 'Toggle comment on the selected region [blockwise]',
        mode = 'x'
      },
    },
    config = function()
      require('Comment').setup {
        -- integrate with nvim-ts-context-commentstring
        pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook()
      }
    end
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
      move_cursor = false, -- keep the cursor position after performing a surround action
    },
  },
}
