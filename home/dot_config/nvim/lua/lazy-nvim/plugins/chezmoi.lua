return {
  { -- https://github.com/xvzc/chezmoi.nvim?tab=readme-ov-file
    'xvzc/chezmoi.nvim',
    name = 'chezmoi-nvim',
    dependencies = { 'nvim-lua/plenary.nvim' },
    config = function()
      require('chezmoi').setup {
        edit = {
          watch = true, -- default 'false'
          -- force = false,
        },

        notification = {
          on_open = false, -- default 'true'
          -- on_apply = true,
          -- on_watch = false,
        },

        -- telescope = {
        --   select = { '<CR>' },
        -- },
      }

      -- Automatically apply changes on files under chezmoi source path
      -- vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
      --   desc = 'Automatically apply changes on files under chezmoi source path',
      --   group = vim.api.nvim_create_augroup('chezmoi-watch', { clear = true }),
      --   pattern = { os.getenv('HOME') .. '/.local/share/chezmoi/*' },
      --   callback = function()
      --     vim.schedule(require('chezmoi.commands.__edit').watch)
      --   end,
      -- })
    end
  }
}
