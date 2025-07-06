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

  -- Spec Versioning
  -- commit = '7e348da', -- FIXME: pinned until #1986 is fixed (https://github.com/hrsh7th/nvim-cmp/pull/1986)
}
