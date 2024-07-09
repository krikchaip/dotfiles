return {
  -- Spec Source
  'stevearc/conform.nvim',
  name = 'conform',

  -- Spec Setup
  config = function()
    require('conform').setup {
      formatters_by_ft = {
        ['_'] = { { 'prettierd', 'prettier' } },
        lua = { 'stylua' },
        nu = {},
      },

      -- Uncomment this to enable format on save
      -- format_on_save = {
      --   timeout_ms = 500,
      --   lsp_fallback = true,
      -- },
    }

    vim.o.formatexpr = 'v:lua.require"conform".formatexpr()'
  end,

  -- Spec Lazy Loading
  event = { 'BufWritePre' },
  cmd = { 'ConformInfo' },
  keys = require 'plugins.lsp.formatter.conform.keymaps',
}
