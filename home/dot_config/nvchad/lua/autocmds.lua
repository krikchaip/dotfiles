require "nvchad.autocmds"

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

-- prevent horizontal scrolling in terminal windows such as nvterm
autocmd("TermOpen", {
  desc = "Prevent accidental horizontal scrolling in terminal windows",
  group = augroup("no-term-scroll", { clear = true }),
  callback = function()
    vim.wo.wrap = true
  end,
})

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

-- avoid scrolling when switch buffers
-- ref: https://vim.fandom.com/wiki/Avoid_scrolling_when_switch_buffers
vim.cmd [[
  " Save current view settings on a per-window, per-buffer basis.
  function! AutoSaveWinView()
    if !exists("w:SavedBufView")
      let w:SavedBufView = {}
    endif

    let w:SavedBufView[bufnr("%")] = winsaveview()
  endfunction

  " Restore current view settings.
  function! AutoRestoreWinView()
    let buf = bufnr("%")

    if exists("w:SavedBufView") && has_key(w:SavedBufView, buf)
      let v = winsaveview()
      let atStartOfFile = v.lnum == 1 && v.col == 0

      if atStartOfFile && !&diff
        call winrestview(w:SavedBufView[buf])
      endif

      unlet w:SavedBufView[buf]
    endif
  endfunction

  " When switching buffers, preserve window view.
  if v:version >= 700
    autocmd BufLeave * call AutoSaveWinView()
    autocmd BufEnter * call AutoRestoreWinView()
  endif
]]
