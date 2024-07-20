local cmp = require 'cmp'
local keymaps = require 'plugins.autocomplete.keymaps'
local lspkind = require 'lspkind'

-- Default Setup
cmp.setup {
  window = {
    completion = cmp.config.window.bordered(),
    documentation = cmp.config.window.bordered { max_width = 60, max_height = 20 },
  },

  view = {
    docs = { auto_open = true },
  },

  completion = {
    completeopt = 'menu,menuone,preview',
  },

  performance = {
    -- debounce = 200, -- default: 60
    -- throttle = 100, -- default: 30
    -- fetching_timeout = 1000, -- default: 500
    -- confirm_resolve_timeout = 160, -- default: 80
    -- async_budget = 1, -- default: 1
    max_view_entries = 100, -- default: 200
  },

  formatting = {
    format = lspkind.cmp_format {
      -- 'text', 'text_symbol', 'symbol_text', 'symbol'
      mode = 'symbol_text',

      maxwidth = 40,
      show_labelDetails = false,

      menu = {
        ['buffer-lines'] = '[Buffer]',
        buffer = '[Buffer]',
        cmdline = '[Command]',
        dotenv = '[ENV]',
        path = '[Path]',
        rpncalc = '[Calc]',
      },
    },
  },

  mapping = keymaps.default(),
  sources = cmp.config.sources {
    { name = 'dotenv', keyword_length = 3 },
    { name = 'path' },
    { name = 'rpncalc' },
    { name = 'buffer' },
  },
}

-- Command Line Setup
cmp.setup.cmdline(':', {
  mapping = keymaps.cmdline(),
  sources = cmp.config.sources({
    { name = 'cmdline' },
  }, {
    { name = 'dotenv', keyword_length = 3 },
    { name = 'path', option = { trailing_slash = true } },
    { name = 'buffer' },
  }),
})

-- Search Setup
cmp.setup.cmdline({ '/', '?' }, {
  mapping = keymaps.cmdline(),
  sources = cmp.config.sources {
    {
      name = 'buffer-lines',
      option = {
        line_numbers = true,
        line_number_separator = ': ',
        leading_whitespace = false,
      },
    },
    {
      name = 'buffer',
      option = {
        -- use the `iskeyword` option for recognizing words
        keyword_pattern = [[\k\+]],
      },
    },
  },
})
