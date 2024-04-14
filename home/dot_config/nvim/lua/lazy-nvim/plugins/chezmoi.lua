return {
  { -- https://github.com/xvzc/chezmoi.nvim
    'xvzc/chezmoi.nvim',
    name = 'chezmoi-watcher',
    dependencies = { 'nvim-lua/plenary.nvim' },
    config = function()
      require('chezmoi').setup {
        -- edit = {
        --   watch = true,
        --   force = false,
        -- },

        -- notification = {
        --   on_open = true,
        --   on_apply = true,
        --   on_watch = false,
        -- },

        -- telescope = {
        --   select = { '<CR>' },
        -- },
      }

      -- Automatically apply changes on files under chezmoi source path
      vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
        desc = 'Automatically apply changes on files under chezmoi source path',
        group = vim.api.nvim_create_augroup('chezmoi-watch', { clear = true }),
        pattern = { os.getenv('HOME') .. '/.local/share/chezmoi/*' },
        callback = function()
          vim.schedule(require('chezmoi.commands.__edit').watch)
        end,
      })
    end
  },

  { -- https://github.com/alker0/chezmoi.vim
    'alker0/chezmoi.vim',
    name = 'chezmoi-highlighter',
    init = function()
      -- This option is required.
      vim.g['chezmoi#use_tmp_buffer'] = true
    end,
  },
}
