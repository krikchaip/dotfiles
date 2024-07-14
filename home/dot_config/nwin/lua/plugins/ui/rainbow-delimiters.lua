return {
  -- Spec Source
  'HiPhish/rainbow-delimiters.nvim',
  name = 'rainbow-delimiters',

  -- Spec Setup
  config = function()
    require('rainbow-delimiters.setup').setup {
      priority = {
        -- default highlighting priority for this plugin.
        -- set this to a low-value if you only want to highlight
        -- just the visual indent guides
        [''] = 10,
      },
    }
  end,
}
