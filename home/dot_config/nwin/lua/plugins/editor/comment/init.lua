local utils = require 'plugins.editor.comment.utils'

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
return {
  -- Spec Source
  'numToStr/Comment.nvim',
  name = 'comment',

  -- Spec Setup
  config = function()
    require('Comment').setup {
      -- integrate with nvim-ts-context-commentstring
      pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
    }
  end,

  -- Spec Lazy Loading
  keys = {
    { 'gc', desc = 'Comment: Linewise ...' },
    { 'gb', desc = 'Comment: Blockwise ...' },

    { '<M-/>', utils.insert_linewise_eol, desc = 'Comment: Insert Linewise at EOL', mode = { 'n', 'i' } },
    { '<C-/>', utils.toggle_linewise_current, desc = 'Comment: Toggle Linewise Current Line', mode = { 'n', 'i' } },
    { '<C-S-/>', utils.toggle_blockwise_current, desc = 'Comment: Toggle Blockwise Current Line', mode = { 'n', 'i' } },

    { '<C-/>', '<Plug>(comment_toggle_linewise_visual)', desc = 'Comment: Toggle Linewise Highlighted', mode = 'x' },
    { '<C-S-/>', '<Plug>(comment_toggle_blockwise_visual)', desc = 'Comment: Toggle Blockwise Highlighted', mode = 'x' },
  },
}
