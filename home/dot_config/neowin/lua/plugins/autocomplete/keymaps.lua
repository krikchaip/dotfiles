local cmp = require 'cmp'
local luasnip = require 'luasnip'
local utils = require 'plugins.autocomplete.utils'

return {
  default = function()
    return {
      -- Suggestion selection
      ['<Up>'] = utils.ics(cmp.mapping.select_prev_item()),
      ['<Down>'] = utils.ics(cmp.mapping.select_next_item()),
      ['<C-k>'] = utils.ics(cmp.mapping.select_prev_item()),
      ['<C-j>'] = utils.ics(cmp.mapping.select_next_item()),
      ['<C-u>'] = utils.ics(cmp.mapping.select_prev_item { count = 8 }),
      ['<C-d>'] = utils.ics(cmp.mapping.select_next_item { count = 8 }),

      -- Doc-window Scrolling
      ['<M-k>'] = utils.ics(cmp.mapping.scroll_docs(-1)),
      ['<M-j>'] = utils.ics(cmp.mapping.scroll_docs(1)),
      ['<M-u>'] = utils.ics(cmp.mapping.scroll_docs(-8)),
      ['<M-d>'] = utils.ics(cmp.mapping.scroll_docs(8)),

      -- Toggle completion menu
      ['<C-Space>'] = utils.ics(function()
        if not cmp.visible() then
          cmp.complete()
        else
          cmp.abort()
        end
      end),

      -- Toggle documentation menu
      ['<M-i>'] = utils.ics(function()
        if not cmp.visible() then return end
        if not cmp.visible_docs() then
          cmp.open_docs()
        else
          cmp.close_docs()
        end
      end),

      -- Accept currently selected item
      ['<CR>'] = utils.is(function(fallback)
        if cmp.visible() then
          cmp.confirm { select = true }
        else
          fallback()
        end
      end),

      -- VSCode like tab mapping
      ['<Tab>'] = utils.is(function(fallback)
        if luasnip.expandable() then return luasnip.expand() end

        if luasnip.locally_jumpable(1) then return luasnip.jump(1) end

        fallback()
      end),

      ['<S-Tab>'] = utils.is(function(fallback)
        if luasnip.locally_jumpable(-1) then
          luasnip.jump(-1)
        else
          fallback()
        end
      end),
    }
  end,

  cmdline = function()
    return {
      ['<Tab>'] = utils.c(function(fallback)
        if cmp.visible() then
          cmp.confirm { select = true }
        else
          fallback()
        end
      end),

      ['<S-Tab>'] = utils.c(function(fallback)
        if cmp.visible() then
          cmp.abort()
        else
          fallback()
        end
      end),
    }
  end,
}
