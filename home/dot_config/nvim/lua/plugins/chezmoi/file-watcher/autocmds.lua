-- Automatically apply changes on files under chezmoi source path
vim.api.nvim_create_autocmd({ 'BufReadPre', 'BufNewFile' }, {
  desc = 'Automatically apply changes on files under chezmoi source path',
  group = vim.api.nvim_create_augroup('chezmoi-watch', { clear = true }),
  pattern = { '*/.local/share/chezmoi/*' },
  callback = function(ev)
    local bufnr = ev.buf

    -- vim.schedule(require('plugins.chezmoi.file-watcher.utils').edit_and_apply)
    vim.schedule(require('plugins.chezmoi.file-watcher.utils').watch(bufnr))
  end,
})
