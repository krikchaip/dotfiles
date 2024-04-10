return {
  'tpope/vim-sleuth', -- Detect tabstop and shiftwidth automatically

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
  --
  -- Use `opts = {}` to force a plugin to be loaded.
  --
  --  This is equivalent to:
  --    require('Comment').setup({})
  {
    'numToStr/Comment.nvim',
    dependencies = {
      {
        'JoosepAlviste/nvim-ts-context-commentstring',
        init = function()
          -- skip backwards compatibility routines and speed up loading
          vim.g.skip_ts_context_commentstring_module = true
        end
      }
    },
    config = function()
      require('Comment').setup {
        -- to integrate with nvim-ts-context-commentstring
        pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook()
      }

      vim.keymap.set('n', '<C-/>', '<Plug>(comment_toggle_linewise_current)', {
        desc = 'Toggle comment on the current line [linewise]',
      })

      vim.keymap.set('n', '<C-S-/>', '<Plug>(comment_toggle_blockwise_current)', {
        desc = 'Toggle comment on the current line [blockwise]',
      })

      vim.keymap.set('x', '<C-/>', '<Plug>(comment_toggle_linewise_visual)', {
        desc = 'Toggle comment on the selected region [linewise]'
      })

      vim.keymap.set('x', '<C-S-/>', '<Plug>(comment_toggle_blockwise_visual)', {
        desc = 'Toggle comment on the selected region [blockwise]'
      })
    end
  },
}