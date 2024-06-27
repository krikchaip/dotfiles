-- if you experience any errors while trying to install plugins,
-- run `:checkhealth` for more info. for example `:checkhealth telescope`

require('lazy').setup('lazy-nvim.plugins', {
  defaults = {
    lazy = true, -- should all plugins be lazy-loaded?
  },

  install = {
    -- try to load one of these colorschemes when starting an installation during startup
    colorscheme = { 'tokyonight', 'monokai-pro' },
  },

  checker = {
    enabled = true, -- automatically check for plugin updates
    notify = false, -- get a notification when new updates are found
  },

  ui = {
    -- The border to use for the UI window. Accepts same border values as |nvim_open_win()|.
    border = 'rounded',

    -- If you are using a Nerd Font: set icons to an empty table which will use the
    -- default lazy.nvim defined Nerd Font icons, otherwise define a unicode icons table
    icons = vim.g.have_nerd_font and {} or {
      cmd = '⌘',
      config = '🛠',
      event = '📅',
      ft = '📂',
      init = '⚙',
      keys = '🗝',
      plugin = '🔌',
      runtime = '💻',
      require = '🌙',
      source = '📄',
      start = '🚀',
      task = '📌',
      lazy = '💤 ',
    },

    -- If defined, the description will be shown in the help menu.
    -- To disable one of the defaults, set it to `false`.
    custom_keys = {
      ['<localleader>l'] = false,
      ['<localleader>t'] = false,
    },
  },
})

-- Open Lazy popup window
vim.keymap.set('n', '<C-S-x>', '<cmd>Lazy<CR>', { desc = 'Open Lazy popup window' })
