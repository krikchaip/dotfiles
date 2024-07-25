-- Minimal and fast autopairs
return {
  -- Spec Source
  'echasnovski/mini.pairs',
  name = 'mini-pairs',

  -- Spec Setup
  config = function()
    require('mini.pairs').setup {
      -- In which modes mappings from this `config` should be created
      modes = { insert = false, command = true, terminal = false },
    }
  end,

  -- Spec Lazy Loading
  event = 'CmdlineEnter',

  -- Spec Versioning
  version = '*',
}
