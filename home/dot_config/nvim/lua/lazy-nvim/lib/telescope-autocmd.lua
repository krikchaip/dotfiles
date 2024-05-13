vim.api.nvim_create_autocmd('User', {
  desc = 'Turn on certain settings when Telescope previewer gets loaded',
  group = vim.api.nvim_create_augroup('telescope-previewer-settings', { clear = true }),
  pattern = 'TelescopePreviewerLoaded',
  callback = function(args)
    vim.wo.number = true

    local no_numbers = {
      help = true,
      netrw = true,
    }

    local filetype = args.data.filetype
    local bufname = args.data.bufname

    if filetype and no_numbers[filetype] then vim.wo.number = false end
    if bufname and bufname:match '*.csv' then vim.wo.wrap = false end
  end,
})
