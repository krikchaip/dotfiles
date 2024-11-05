-- Telescope LuaSnip snippets picker
return {
  -- Spec Source
  'benfowler/telescope-luasnip.nvim',
  name = 'telescope-luasnip',

  -- Spec Loading
  dependencies = { 'telescope', 'luasnip' },

  -- Spec Setup
  config = function()
    require('telescope').load_extension 'luasnip'
  end,

  -- Spec Lazy Loading
  keys = {
    { '<M-\\>', '<cmd>Telescope luasnip<CR>', desc = 'Search: LuaSnip Snippets', mode = { 'n', 'i' } },
  },
}
