-- Automatically save/restore nvim session, including buffers, window layouts and tabs
return {
  -- Spec Source
  'rmagatti/auto-session',
  name = 'auto-session',

  -- Spec Setup
  config = function()
    require 'plugins.editor.auto-session.opts'
    require 'plugins.editor.auto-session.setup'
  end,

  -- Spec Lazy Loading
  cmd = { 'SessionSave', 'SessionRestore', 'SessionDelete', 'SessionPurgeOrphaned', 'Autosession' },
  keys = { { '<leader>s', '<cmd>Telescope session-lens<CR>', desc = 'Session: Open Session Lens' } },
}
