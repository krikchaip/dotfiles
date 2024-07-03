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
}

-- Open Lazy popup window
vim.keymap.set('n', '<C-S-x>', '<cmd>Lazy<CR>', { desc = 'Open Lazy popup window' })
