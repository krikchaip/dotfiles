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
      -- Enable standardized comments snippets
      require('luasnip').filetype_extend('lua', { 'luadoc' })
      require('luasnip').filetype_extend('sh', { 'shelldoc' })
      require('luasnip').filetype_extend('javascript', { 'jsdoc' })
      require('luasnip').filetype_extend('javascriptreact', { 'jsdoc' })
      require('luasnip').filetype_extend('typescript', { 'jsdoc' })
      require('luasnip').filetype_extend('typescriptreact', { 'jsdoc' })

      -- Add missing Javascript snippets
      require('luasnip').filetype_extend('typescript', { 'javascript' })
      require('luasnip').filetype_extend('typescriptreact', { 'javascript' })

      -- There're times we write React code in normal Typescript files
      require('luasnip').filetype_extend('typescript', { 'typescriptreact' })

      -- You MUST call filetype_extends before calling lazy_load,
      -- Otherwise the extended snippets won't get load.
      -- ref: https://www.reddit.com/r/neovim/comments/1ahfg53/luasnip_cant_use_javascript_snippets_in
      require('luasnip.loaders.from_vscode').lazy_load()

      require('luasnip').config.setup(opts)
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

      cmp.setup {
        snippet = {
          expand = function(args) require('luasnip').lsp_expand(args.body) end,
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
