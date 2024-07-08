return {
  -- Spec Source
  'hrsh7th/nvim-cmp',
  name = 'cmp',

  -- Spec Loading
  dependencies = {
    require 'plugins.autocomplete.snippets',
    require 'plugins.autocomplete.sources',

    -- Entries formatter
    { 'onsails/lspkind.nvim', name = 'lspkind' },
  },

  -- Spec Setup
  config = function()
    require 'plugins.autocomplete.setup'
  end,

  -- Spec Lazy Loading
  event = { 'InsertEnter', 'CmdlineEnter' },
}
