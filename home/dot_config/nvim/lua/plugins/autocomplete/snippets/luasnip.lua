-- Snippet provider engine
return {
  -- Spec Source
  'L3MON4D3/LuaSnip',
  name = 'luasnip',

  -- Spec Loading
  dependencies = { 'friendly-snippets' },

  -- Spec Setup
  opts = {},
  build = vim.fn.has 'win32' ~= 0 and 'make install_jsregexp' or nil,

  -- Spec Versioning
  version = 'v2.*',
}
