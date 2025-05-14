-- Highlight when yanking (copying) text
-- ref: https://github.com/nvim-lua/kickstart.nvim/blob/master/init.lua#L196-L205
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('highlight-yank', { clear = true }),
  callback = function()
    vim.hl.on_yank()
  end,
})

-- User event that loads after UIEnter + only if file buf is there
-- ref: https://github.com/NvChad/NvChad/blob/v2.5/lua/nvchad/autocmds.lua
vim.api.nvim_create_autocmd({ 'UIEnter', 'BufReadPost', 'BufNewFile' }, {
  desc = 'Trigger FilePost event after UIEnter + only if file buf is there',
  group = vim.api.nvim_create_augroup('file-post', { clear = true }),
  callback = function(args)
    local file = vim.api.nvim_buf_get_name(args.buf)
    local buftype = vim.api.nvim_get_option_value('buftype', { buf = args.buf })

    if not vim.g.ui_entered and args.event == 'UIEnter' then vim.g.ui_entered = true end

    if file ~= '' and buftype ~= 'nofile' and vim.g.ui_entered then
      vim.api.nvim_exec_autocmds('User', { pattern = 'FilePost', modeline = false })
      vim.api.nvim_del_augroup_by_name 'file-post'

      vim.schedule(function()
        vim.api.nvim_exec_autocmds('FileType', {})
        if vim.g.editorconfig then require('editorconfig').config(args.buf) end
      end)
    end
  end,
})

-- Adjust nvim windows size when 'lines' or 'columns' changes
-- ref: https://neovim.discourse.group/t/how-can-i-get-size-of-my-current-workspace/1876/2
vim.api.nvim_create_autocmd('VimResized', {
  desc = 'Balance nvim windows when terminal screen resizes',
  group = vim.api.nvim_create_augroup('balance-windows', { clear = true }),
  callback = function()
    local current_tab = vim.fn.tabpagenr()

    vim.cmd [[tabdo wincmd =]]
    vim.cmd('tabn ' .. current_tab)
  end,
})
