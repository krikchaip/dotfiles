local RELOAD_FTS = { '', 'gitignore' }

vim.api.nvim_create_autocmd('ModeChanged', {
  desc = 'Redraw Tabline on mode changes',
  group = vim.api.nvim_create_augroup('tabby-reload-modechanges', { clear = true }),
  callback = function()
    local buf = vim.api.nvim_get_current_buf()
    local ft = vim.api.nvim_get_option_value('filetype', { buf = buf })
    local wintype = vim.fn.win_gettype()

    -- prevent tabline to flicker on certain filetypes by simply rerender it
    if vim.tbl_contains(RELOAD_FTS, ft) and wintype == '' then vim.cmd.redrawtabline() end

    -- refresh tabline for diffviews
    if vim.wo.diff then vim.cmd.redrawtabline() end
  end,
})
