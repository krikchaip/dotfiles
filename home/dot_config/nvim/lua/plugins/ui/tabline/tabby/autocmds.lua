vim.api.nvim_create_autocmd('ModeChanged', {
  desc = 'Redraw Tabline on mode changes',
  group = vim.api.nvim_create_augroup('tabby-reload-modechanges', { clear = true }),
  callback = function()
    local buf = vim.api.nvim_get_current_buf()
    local ft = vim.api.nvim_get_option_value('filetype', { buf = buf })
    local wintype = vim.fn.win_gettype()

    -- prevent tabline to flicker on empty buffers by simply rerender it
    if ft == '' and wintype == '' then vim.cmd.redrawtabline() end
  end,
})
