vim.g.mapleader = ' '
vim.g.maplocalleader = ' '

local lazypath = vim.fn.stdpath 'data' .. '/lazy/lazy.nvim'

if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system {
    'git',
    'clone',
    '--filter=blob:none',
    '--branch=stable', -- latest stable release
    'https://github.com/folke/lazy.nvim.git',
    lazypath,
  }
end

vim.opt.rtp:prepend(lazypath)

require('lazy').setup {
  -- leave nil when passing the spec as the first argument to setup()
  spec = {
    { import = 'plugins' },
  },

  defaults = {
    -- should all plugins be lazy-loaded?
    lazy = true,
  },

  install = {
    -- try to load one of these colorschemes when starting an installation during startup
    colorscheme = { 'tokyonight' },

    -- install missing plugins on startup. this doesn't increase startup time.
    -- ps. setting this to `true` requires `global` module to be loaded first before lazy startup
    missing = false,
  },

  checker = {
    -- automatically check for plugin updates
    enabled = true,

    -- get a notification when new updates are found
    notify = false,
  },

  ui = {
    -- The border to use for the UI window. Accepts same border values as |nvim_open_win()|.
    border = 'rounded',
  },

  performance = {
    rtp = {
      disabled_plugins = {
        '2html_plugin',
        'bugreport',
        'compiler',
        'editorconfig',
        'ftplugin',
        'getscript',
        'getscriptPlugin',
        'gzip',
        'logipat',
        'man',
        'matchit',
        'matchparen',
        'netrw',
        'netrwFileHandlers',
        'netrwPlugin',
        'netrwSettings',
        'optwin',
        'osc52',
        'rplugin',
        'rrhelper',
        'shada',
        'spellfile',
        'spellfile_plugin',
        'synmenu',
        'syntax',
        'tar',
        'tarPlugin',
        'tohtml',
        'tutor',
        'vimball',
        'vimballPlugin',
        'zip',
        'zipPlugin',
      },
    },
  },
}
