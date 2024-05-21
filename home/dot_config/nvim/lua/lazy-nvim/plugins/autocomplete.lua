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
  { 'amarakon/nvim-cmp-buffer-lines', name = 'cmp.buffer-lines' },
  { 'PhilRunninger/cmp-rpncalc', name = 'cmp.rpncalc' },
  { 'hrsh7th/cmp-nvim-lsp', name = 'cmp.lsp' },
  { 'hrsh7th/cmp-nvim-lsp-document-symbol', name = 'cmp.lsp-document-symbol' },
  { 'hrsh7th/cmp-path', name = 'cmp.path' },
  { 'hrsh7th/cmp-cmdline', name = 'cmp.cmdline' },

  {
    'hrsh7th/nvim-cmp',
    name = 'cmp',
    event = { 'InsertEnter', 'CmdlineEnter' },
    dependencies = {
      'cmp.luasnip',
      'cmp.buffer',
      'cmp.buffer-lines',
      'cmp.rpncalc',
      'cmp.lsp',
      'cmp.lsp-document-symbol',
      'cmp.path',
      'cmp.cmdline',
    },
    init = function()
      -- Limit completion window max_height
      vim.opt.pumheight = 20
    end,
    config = function()
      local cmp = require 'cmp'
      local luasnip = require 'luasnip'

      -- Enable mapping in all modes
      local ics = function(mapping_fn) return cmp.mapping(mapping_fn, { 'i', 'c', 's' }) end

      -- Enable mapping except command mode
      local is = function(mapping_fn) return cmp.mapping(mapping_fn, { 'i', 's' }) end

      cmp.setup {
        snippet = {
          expand = function(args) require('luasnip').lsp_expand(args.body) end,
        },

        window = {
          documentation = {
            max_width = 60,
            max_height = 20,
          },
        },

        view = {
          docs = { auto_open = true },
        },

        completion = {
          completeopt = 'menu,menuone,preview,noinsert',
        },

        performance = {
          max_view_entries = 100,
        },

        mapping = {
          -- Suggestion selection
          ['<Up>'] = ics(cmp.mapping.select_prev_item()),
          ['<Down>'] = ics(cmp.mapping.select_next_item()),
          ['<C-k>'] = ics(cmp.mapping.select_prev_item()),
          ['<C-j>'] = ics(cmp.mapping.select_next_item()),
          ['<C-u>'] = ics(cmp.mapping.select_prev_item { count = 8 }),
          ['<C-d>'] = ics(cmp.mapping.select_next_item { count = 8 }),

          -- Doc-window Scrolling
          ['<M-k>'] = ics(cmp.mapping.scroll_docs(-1)),
          ['<M-j>'] = ics(cmp.mapping.scroll_docs(1)),
          ['<M-u>'] = ics(cmp.mapping.scroll_docs(-8)),
          ['<M-d>'] = ics(cmp.mapping.scroll_docs(8)),

          -- Toggle completion menu
          ['<C-Space>'] = ics(function()
            if not cmp.visible() then return cmp.complete() end

            cmp.abort()
          end),

          -- Toggle documentation menu
          ['<C-i>'] = ics(function()
            if not cmp.visible_docs() then cmp.open_docs() end

            cmp.close_docs()
          end),

          -- Accept currently selected item
          ['<CR>'] = is(function(fallback)
            if cmp.visible() then return cmp.confirm { select = true } end

            if luasnip.expandable() then return luasnip.expand() end

            fallback()
          end),

          -- VSCode like tab mapping
          ['<Tab>'] = ics(function(fallback)
            if cmp.visible() then return cmp.confirm { select = true } end

            if luasnip.expandable() then return luasnip.expand() end

            if luasnip.locally_jumpable(1) then return luasnip.jump(1) end

            fallback()
          end),

          ['<S-Tab>'] = ics(function(fallback)
            if cmp.visible() then return cmp.abort() end

            if luasnip.locally_jumpable(-1) then return luasnip.jump(-1) end

            fallback()
          end),
        },

        sources = cmp.config.sources({
          { name = 'nvim_lsp' },
          { name = 'luasnip' },
        }, {
          { name = 'rpncalc' },
          { name = 'buffer' },
        }),
      }

      cmp.setup.cmdline(':', {
        sources = cmp.config.sources({
          { name = 'cmdline' },
        }, {
          { name = 'path', option = { trailing_slash = true } },
        }, {
          { name = 'buffer' },
        }),
      })

      cmp.setup.cmdline({ '/', '?' }, {
        sources = cmp.config.sources({
          { name = 'nvim_lsp_document_symbol' },
        }, {
          {
            name = 'buffer',
            option = {
              -- use the `iskeyword` option for recognizing words
              keyword_pattern = [[\k\+]],
            },
          },
          {
            name = 'buffer-lines',
            option = {
              line_numbers = true,
              line_number_separator = ': ',
              leading_whitespace = false,
            },
          },
        }),
      })
    end,
  },
}
