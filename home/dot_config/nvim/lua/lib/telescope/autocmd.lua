vim.api.nvim_create_autocmd('User', {
  desc = 'Turn on certain settings when Telescope previewer gets loaded',
  pattern = 'TelescopePreviewerLoaded',
  group = vim.api.nvim_create_augroup('telescope-previewer-settings', { clear = true }),
  callback = function(args)
    vim.wo.number = true

    local no_numbers = { help = true, netrw = true }
    if no_numbers[args.data.filetype] then
      vim.wo.number = false
    end

    if args.data.bufname:match('*.csv') then
      vim.wo.wrap = false
    end
  end,
})
