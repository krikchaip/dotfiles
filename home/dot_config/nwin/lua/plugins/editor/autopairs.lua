-- A super powerful autopair plugin that supports multiple characters
-- ref: https://github.com/windwp/nvim-autopairs
return {
  -- Spec Source
  'windwp/nvim-autopairs',
  name = 'autopairs',

  -- Spec Setup
  opts = {
    disable_filetype = {},

    -- disable when insert after visual block mode
    disable_in_visualblock = false,

    -- add bracket pairs after quote
    enable_afterquote = true,

    -- switch for basic rule break undo sequence
    break_undo = true,

    -- use treesitter to check for a pair
    check_ts = true,
  },

  -- Spec Lazy Loading
  event = 'InsertEnter',
}
