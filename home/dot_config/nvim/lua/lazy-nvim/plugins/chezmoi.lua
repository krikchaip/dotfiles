return {
  {
    'xvzc/chezmoi.nvim',
    name = 'chezmoi.file-watcher',
    dependencies = { 'plenary' },
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

  {
    'alker0/chezmoi.vim',
    name = 'chezmoi.syntax-highlighter',
    init = function()
      -- This option is required.
      vim.g['chezmoi#use_tmp_buffer'] = true
    end,
  },
}
