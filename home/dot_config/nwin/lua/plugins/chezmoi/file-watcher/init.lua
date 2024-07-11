return {
  -- Spec Source
  'xvzc/chezmoi.nvim',
  name = 'chezmoi-file-watcher',

  -- Spec Setup
  config = function()
    require 'plugins.chezmoi.file-watcher.setup'
    require 'plugins.chezmoi.file-watcher.autocmds'
  end,

  -- Spec Lazy Loading
  event = {
    'BufReadPre */.local/share/chezmoi/*',
    'BufNewFile */.local/share/chezmoi/*',
  },
}
