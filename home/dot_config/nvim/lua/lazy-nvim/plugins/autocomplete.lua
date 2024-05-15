return {
  -- A Collection of VSCode snippets across many different programming languages
  {
    'rafamadriz/friendly-snippets',
    name = 'friendly-snippets',
    config = function()
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
    end,
  },

  -- Snippet provider engine
  {
    'L3MON4D3/LuaSnip',
    name = 'luasnip',
    version = 'v2.*',
    build = vim.fn.has 'win32' ~= 0 and 'make install_jsregexp' or nil,
    dependencies = { 'friendly-snippets' },
    opts = {},
  },

  -- Completion sources
  { 'saadparwaiz1/cmp_luasnip', name = 'cmp.luasnip', dependencies = { 'luasnip' } },
  { 'hrsh7th/cmp-buffer', name = 'cmp.buffer' },
  { 'hrsh7th/cmp-calc', name = 'cmp.calc' },
  { 'hrsh7th/cmp-nvim-lsp', name = 'cmp.lsp' },
  { 'hrsh7th/cmp-nvim-lsp-signature-help', name = 'cmp.lsp-signature' },

  {
    'hrsh7th/nvim-cmp',
    name = 'cmp',
    event = { 'InsertEnter', 'CmdlineEnter' },
    dependencies = {
      'cmp.luasnip',
      'cmp.buffer',
      'cmp.calc',
      'cmp.lsp',
      'cmp.lsp-signature',
    },
    config = function()
      local cmp = require 'cmp'
      local luasnip = require 'luasnip'

      cmp.setup {
        snippet = {
          expand = function(args) require('luasnip').lsp_expand(args.body) end,
        },

        completion = {
          completeopt = 'menu,menuone,preview,noinsert',
        },

        mapping = {
          -- Suggestion selection
          ['<C-k>'] = cmp.mapping.select_prev_item(),
          ['<C-j>'] = cmp.mapping.select_next_item(),

          -- Doc-window Scrolling
          ['<M-k>'] = cmp.mapping.scroll_docs(-1),
          ['<M-j>'] = cmp.mapping.scroll_docs(1),
          ['<M-u>'] = cmp.mapping.scroll_docs(-8),
          ['<M-d>'] = cmp.mapping.scroll_docs(8),

          -- Toggle the completion menu
          ['<C-Space>'] = cmp.mapping(function()
            if not cmp.visible() then
              cmp.complete()
            else
              cmp.close()
            end
          end),

          -- Accept currently selected item
          ['<CR>'] = cmp.mapping(function(fallback)
            if not cmp.visible() then return fallback() end

            -- Set `select` to `false` to only confirm explicitly selected items.
            if not luasnip.expandable() then return cmp.confirm { select = true } end

            luasnip.expand()
          end),

          -- VSCode like tab mapping
          ['<Tab>'] = cmp.mapping(function(fallback)
            if cmp.visible() then
              if not luasnip.expandable() then return cmp.confirm { select = true } end
              return luasnip.expand()
            end

            if luasnip.locally_jumpable(1) then return luasnip.jump(1) end

            fallback()
          end, { 'i', 's' }),

          ['<S-Tab>'] = cmp.mapping(function(fallback)
            if cmp.visible() then return cmp.abort() end

            if luasnip.locally_jumpable(-1) then return luasnip.jump(-1) end

            fallback()
          end, { 'i', 's' }),
        },

        sources = cmp.config.sources {
          { name = 'nvim_lsp_signature_help' },
          { name = 'nvim_lsp' },
          { name = 'luasnip' },
          { name = 'calc' },
          { name = 'buffer' },
        },
      }
    end,
  },
}
