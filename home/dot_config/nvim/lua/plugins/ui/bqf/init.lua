-- A better quickfix window
-- ref: https://github.com/kevinhwang91/nvim-bqf
return {
  -- Spec Source
  'kevinhwang91/nvim-bqf',
  name = 'bqf',

  -- Spec Setup
  config = function()
    require 'plugins.ui.bqf.setup'
    require 'plugins.ui.bqf.autocmds'
  end,

  -- Spec Lazy Loading
  cmd = { 'Cdo', 'Cfdo' },
  ft = 'qf',
}
