return {
  -- A Collection of VSCode snippets across many different programming languages
  { 'rafamadriz/friendly-snippets', name = 'friendly-snippets' },

  -- Snippet provider engine
  {
    'L3MON4D3/LuaSnip',
    name = 'luasnip',
    version = 'v2.*',
    build = vim.fn.has 'win32' ~= 0 and 'make install_jsregexp' or nil,
    dependencies = { 'friendly-snippets' },
    opts = {},
    config = function(_, opts)
      require('luasnip').config.setup(opts)
      require('luasnip.loaders.from_vscode').lazy_load()
    end,
  },

  -- Completion sources
  { 'saadparwaiz1/cmp_luasnip', name = 'cmp.luasnip', dependencies = { 'luasnip' } },

  {
    'hrsh7th/nvim-cmp',
    name = 'cmp',
    event = { 'InsertEnter' },
    dependencies = { 'cmp.luasnip' },
    config = function()
      local cmp = require 'cmp'
      local luasnip = require 'luasnip'

      cmp.setup {
        snippet = {
          expand = function(args) luasnip.lsp_expand(args.body) end,
        },

        completion = {
          completeopt = 'menu,menuone,preview,noinsert',
        },

        mapping = cmp.mapping.preset.insert {
          ['<C-b>'] = cmp.mapping.scroll_docs(-4),
          ['<C-f>'] = cmp.mapping.scroll_docs(4),
          ['<C-Space>'] = cmp.mapping.complete(),
          ['<C-e>'] = cmp.mapping.abort(),

          -- Accept currently selected item. Set `select` to `false`
          -- to only confirm explicitly selected items.
          ['<CR>'] = cmp.mapping.confirm { select = true },
        },

        sources = cmp.config.sources {
          -- { name = 'nvim_lsp' },
          { name = 'luasnip' },
        },
      }
    end,
  },
}
