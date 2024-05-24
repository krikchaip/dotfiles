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

      -- There're times that we write React code in normal Typescript files
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
  { 'hrsh7th/cmp-nvim-lsp-signature-help', name = 'cmp.lsp-signature-help' },
  { 'hrsh7th/cmp-path', name = 'cmp.path' },
  { 'hrsh7th/cmp-cmdline', name = 'cmp.cmdline' },
  { 'SergioRibera/cmp-dotenv', name = 'cmp.dotenv' },

  -- Entries formatter
  { 'onsails/lspkind.nvim', name = 'lspkind' },

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
      'cmp.lsp-signature-help',
      'cmp.path',
      'cmp.cmdline',
      'cmp.dotenv',
    },
    init = function()
      -- Limit completion window max_height
      vim.opt.pumheight = 20
    end,
    config = function()
      local cmp = require 'cmp'
      local luasnip = require 'luasnip'
      local lspkind = require 'lspkind'

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
          -- debounce = 200, -- default: 60
          -- throttle = 100, -- default: 30
          -- fetching_timeout = 1000, -- default: 500
          -- confirm_resolve_timeout = 160, -- default: 80
          -- async_budget = 1, -- default: 1
          max_view_entries = 100, -- default: 200
        },

        formatting = {
          format = lspkind.cmp_format {
            mode = 'symbol_text', -- 'text', 'text_symbol', 'symbol_text', 'symbol'
            maxwidth = 40,
            show_labelDetails = false,
            menu = {
              buffer = '[Buffer]',
              cmdline = '[Command]',
              dotenv = '[ENV]',
              luasnip = '[LuaSnip]',
              nvim_lsp = '[LSP]',
              nvim_lsp_signature_help = '[Signature]',
              path = '[Path]',
              rpncalc = '[Calc]',
            },
          },
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
          { name = 'nvim_lsp_signature_help' },
        }, {
          { name = 'nvim_lsp', max_item_count = 100 },
          { name = 'luasnip' },
        }, {
          { name = 'buffer' },
          { name = 'dotenv', keyword_length = 3 },
          { name = 'path' },
          { name = 'rpncalc' },
        }),
      }

      cmp.setup.cmdline(':', {
        sources = cmp.config.sources({
          { name = 'cmdline' },
        }, {
          { name = 'buffer' },
          { name = 'dotenv', keyword_length = 3 },
          { name = 'path', option = { trailing_slash = true } },
        }),
      })

      cmp.setup.cmdline({ '/', '?' }, {
        sources = cmp.config.sources {
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
        },
      })

      -- Add parentheses after selecting function or method item
      -- ref: https://github.com/hrsh7th/nvim-cmp/wiki/Advanced-techniques#add-parentheses-after-selecting-function-or-method-item
      cmp.event:on('confirm_done', function(evt)
        local aupairs_cmp = require 'nvim-autopairs.completion.cmp'
        local confirm_done = aupairs_cmp.on_confirm_done()

        return confirm_done(evt)
      end)
    end,
  },
}
