return {
  {
    'stevearc/conform.nvim',
    name = 'conform',
    event = { 'BufWritePre' },
    cmd = { 'ConformInfo' },
    keys = {
      {
        '<leader>=',
        function() require('conform').format { async = true, lsp_fallback = true } end,
        desc = 'Format current buffer or selected range',
        mode = { 'n', 'x' },
      },
    },
    opts = {
      format_on_save = {
        timeout_ms = 500,
        lsp_fallback = true,
      },

      formatters_by_ft = {
        ['_'] = { { 'prettierd', 'prettier' } },
        lua = { 'stylua' },
      },
    },
    init = function() vim.o.formatexpr = 'v:lua.require"conform".formatexpr()' end,
  },
}
