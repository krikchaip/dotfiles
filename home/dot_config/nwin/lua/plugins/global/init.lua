return {
  -- Spec Source
  dir = vim.fs.joinpath(vim.fn.stdpath 'config', 'lua', 'plugins', 'global'),
  name = 'global',

  -- Spec Loading
  priority = 9999,

  -- Spec Setup
  config = function()
    require 'plugins.global.vars'
    require 'plugins.global.opts'
  end,

  -- Spec Lazy Loading
  lazy = false,
}