-- autoclose and autorename html-like tag
-- ref: https://github.com/windwp/nvim-ts-autotag
return {
  -- Spec Source
  'windwp/nvim-ts-autotag',
  name = 'treesitter-autotag',

  -- Spec Setup
  opts = {
    opts = {
      -- Auto close on trailing </
      enable_close_on_slash = true,
    },
  },

  -- Spec Lazy Loading
  event = 'User FilePost',
}
