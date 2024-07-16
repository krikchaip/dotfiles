-- Make Nvim's fold look much prettier & modern
-- ref: https://github.com/kevinhwang91/nvim-ufo
return {
  -- Spec Source
  'kevinhwang91/nvim-ufo',
  name = 'ufo',

  -- Spec Setup
  config = function()
    require 'plugins.ui.ufo.opts'
    require 'plugins.ui.ufo.setup'
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  keys = {
    { ']z', '<cmd>lua require("ufo").goNextClosedFold()<CR>', desc = 'UFO: Fold Region' },
    { '[z', '<cmd>lua require("ufo").goPreviousClosedFold()<CR>', desc = 'UFO: Fold Region' },
  },
}
