return {
  -- Spec Source
  'mikesmithgh/kitty-scrollback.nvim',
  name = 'kitty-scrollback',

  -- Spec Setup
  opts = {
    {
      -- restore options that were modified while processing the scrollback buffer
      restore_options = true,
    },
  },

  -- Spec Lazy Loading
  event = 'User KittyScrollbackLaunch',
  cmd = { 'KittyScrollbackGenerateKittens', 'KittyScrollbackCheckHealth' },

  -- Spec Versioning
  version = '^5.0.0',
}
