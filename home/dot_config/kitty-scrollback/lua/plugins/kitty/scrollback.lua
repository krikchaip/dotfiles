return {
  -- Spec Source
  'mikesmithgh/kitty-scrollback.nvim',
  name = 'kitty-scrollback',

  -- Spec Setup
  opts = {},

  -- Spec Lazy Loading
  event = 'User KittyScrollbackLaunch',
  cmd = { 'KittyScrollbackGenerateKittens', 'KittyScrollbackCheckHealth' },

  -- Spec Versioning
  version = '^5.0.0',
}
