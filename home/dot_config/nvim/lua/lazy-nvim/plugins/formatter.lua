return {
  {
    'stevearc/conform.nvim',
    name = 'conform',
    event = { 'BufWritePre' },
    cmd = { 'ConformInfo' },
    keys = {
      {
        '<leader>W',
        function()
          require('conform').format({ async = false, lsp_fallback = true }, function(err, _)
            if err then return vim.notify(err, vim.log.levels.ERROR) end
            vim.cmd [[write]]
          end)
        end,
        desc = 'Format and write current buffer',
      },
      {
        '<leader>=',
        function() require('conform').format { async = true, lsp_fallback = true } end,
        desc = 'Format current buffer or selected range',
        mode = { 'n', 'x' },
      },
    },
    opts = {
      formatters_by_ft = {
        ['_'] = { { 'prettierd', 'prettier' } },
        lua = { 'stylua' },
      },

      -- Uncomment this to enable format on save
      -- format_on_save = {
      --   timeout_ms = 500,
      --   lsp_fallback = true,
      -- },
    },
    init = function() vim.o.formatexpr = 'v:lua.require"conform".formatexpr()' end,
  },
}
