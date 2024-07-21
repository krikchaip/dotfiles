return {
  -- Spec Source
  'stevearc/conform.nvim',
  name = 'conform',

  -- Spec Setup
  config = function()
    require('conform').setup {
      formatters_by_ft = {
        ['_'] = { 'prettierd' },
        lua = { 'stylua' },
        nu = { lsp_format = 'fallback' },
      },

      -- Change the default values when calling conform.format()
      -- This will also affect the default values for format_on_save/format_after_save
      default_format_opts = {
        lsp_format = 'fallback',
      },

      -- notify when a formatter errors
      notify_on_error = false,

      -- notify when no formatters are available for the buffer
      notify_no_formatters = false,
    }

    vim.o.formatexpr = 'v:lua.require"conform".formatexpr()'
  end,

  -- Spec Lazy Loading
  cmd = { 'ConformInfo' },
  keys = require 'plugins.lsp.formatter.conform.keymaps',
}
