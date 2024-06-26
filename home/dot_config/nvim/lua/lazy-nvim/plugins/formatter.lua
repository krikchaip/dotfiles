return {
  {
    'stevearc/conform.nvim',
    name = 'conform',
    event = { 'BufWritePre' },
    cmd = { 'ConformInfo' },
    keys = {
      {
        '<leader>w',
        function()
          require('conform').format({ async = false, lsp_fallback = true }, function(err, _)
            if err then vim.notify_once(err, vim.log.levels.ERROR) end
            vim.cmd [[write]]
          end)
        end,
        desc = 'Buffer: Format and Write Current',
      },

      { '<leader>W', '<cmd>w<CR>', desc = 'Buffer: Write Current' },

      {
        '<leader>=',
        function() require('conform').format { async = true, lsp_fallback = true } end,
        desc = 'Format: Current Context',
        mode = { 'n', 'x' },
      },
    },
    opts = {
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
    },
    init = function() vim.o.formatexpr = 'v:lua.require"conform".formatexpr()' end,
  },
}
