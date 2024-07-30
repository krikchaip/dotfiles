-- Automatically save/restore nvim session, including buffers, window layouts and tabs
return {
  -- Spec Source
  'rmagatti/auto-session',
  name = 'auto-session',

  -- Spec Setup
  config = function()
    require 'plugins.editor.auto-session.opts'
    require 'plugins.editor.auto-session.setup'
    require 'plugins.editor.auto-session.keymaps'
  end,

  -- Spec Lazy Loading
  cmd = {
    'SessionDelete',
    'SessionPurgeOrphaned',
    'SessionRestore',
    'SessionSave',
  },

  -- Spec Versioning
  tag = 'v2.5.0',
}
