-- Enable super zen mode by dims inactive portions of the code 👍🏻
-- ref: https://github.com/folke/twilight.nvim
return {
  -- Spec Source
  'folke/twilight.nvim',
  name = 'twilight',

  -- Spec Setup
  opts = {
    dimming = {
      -- when true, other windows will be fully dimmed (unless they contain the same buffer)
      inactive = false,
    },

    -- amount of lines we will try to show around the current line
    context = 10,
  },

  -- Spec Lazy Loading
  keys = {
    { '<leader>z', '<cmd>Twilight<CR>', desc = 'Zenmode: Toggle 🧘' },
  },
}
