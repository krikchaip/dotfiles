vim.opt.sessionoptions = {
  -- When restoring plugin help pages (eg. telescope), it also requires the plugin to be loaded first.
  -- Therefore, if the plugin is lazy loaded while having your session containing its help page.
  -- There will be times that restoring the session might fail.
  -- 'help',

  -- 'blank',
  -- 'terminal',

  'buffers',
  'curdir',
  'folds',
  'globals',
  'tabpages',
  'winpos',
  'winsize',
}
