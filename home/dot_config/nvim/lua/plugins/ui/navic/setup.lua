require('nvim-navic').setup {
  highlight = true,
  depth_limit = 3,
  click = true,
  lsp = { auto_attach = true },
}

require('plugins.ui.navic.utils').setup_highlights()
