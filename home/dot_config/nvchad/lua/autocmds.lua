require "nvchad.autocmds"

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

-- highlight text after yanking
-- ref: https://github.com/nvim-lua/kickstart.nvim/blob/master/init.lua#L196-L205
autocmd("TextYankPost", {
  desc = "Highlight when yanking (copying) text",
  group = augroup("highlight-yank", { clear = true }),
  callback = function()
    vim.hl.on_yank()
  end,
})

-- restore cursor position on file open
-- ref: https://nvchad.com/docs/recipes
autocmd("BufReadPost", {
  desc = "Restore cursor position on file open",
  group = augroup("restore-cursor", { clear = true }),
  pattern = "*",
  callback = function()
    local line = vim.fn.line "'\""
    if
      line > 1
      and line <= vim.fn.line "$"
      and vim.bo.filetype ~= "commit"
      and vim.fn.index({ "xxd", "gitrebase" }, vim.bo.filetype) == -1
    then
      vim.cmd 'normal! g`"'
    end
  end,
})

-- show nvdash when all buffers are closed
-- ref: https://nvchad.com/docs/recipes
autocmd("BufDelete", {
  desc = "Show NvDash when all buffers are closed",
  group = augroup("show-nvdash", { clear = true }),
  callback = function()
    local bufs = vim.t.bufs
    if #bufs == 1 and vim.api.nvim_buf_get_name(bufs[1]) == "" then vim.cmd "Nvdash" end
  end,
})

-- configure the `vim_buffer_` previewer
-- ref: https://github.com/nvim-telescope/telescope.nvim#previewers
autocmd("User", {
  desc = "Set Vim options for Telescope previewer",
  group = augroup("telescope-previewer", { clear = true }),
  pattern = "TelescopePreviewerLoaded",
  callback = function(args)
    vim.wo.number = true

    local no_numbers = {
      help = true,
      netrw = true,
    }

    local filetype = args.data.filetype
    local bufname = args.data.bufname

    if filetype and no_numbers[filetype] then vim.wo.number = false end
    if bufname and bufname:match "*.csv" then vim.wo.wrap = false end
  end,
})
