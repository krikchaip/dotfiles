local pickers = require 'plugins.telescope.pickers'

return {
  'filename',

  -- 0: Just the filename
  -- 1: Relative path
  -- 2: Absolute path
  -- 3: Absolute path, with tilde as the home directory
  -- 4: Filename and parent dir, with tilde as the home directory
  path = 4,

  symbols = {
    modified = '',
    readonly = '',
    unnamed = 'Untitled',
    newfile = '', -- Text to show for newly created file before first write
  },

  on_click = function()
    pickers.find_files()
  end,
}
