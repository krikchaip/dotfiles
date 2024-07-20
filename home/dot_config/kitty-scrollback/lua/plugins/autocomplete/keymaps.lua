local cmp = require 'cmp'
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
      ['<C-i>'] = utils.ics(function()
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
