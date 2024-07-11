return {
  -- Spec Source
  'NvChad/nvim-colorizer.lua',
  name = 'colorizer',

  -- Spec Setup
  config = function()
    require('colorizer').setup {
      user_default_options = {
        -- Enable all CSS features: names, RGB, RRGGBB, RRGGBBAA, hsl_fn, rgb_fn
        css = true,

        -- Enable tailwind colors
        -- Available methods are false / true / "normal" / "lsp" / "both"
        -- True is same as normal
        tailwind = 'lsp',
      },
    }
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
