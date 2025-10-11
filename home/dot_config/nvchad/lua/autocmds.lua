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

-- show nvdash when all buffers are closed
-- ref: https://nvchad.com/docs/recipes
autocmd("BufDelete", {
  desc = "Show NvDash when all buffers are closed",
  group = augroup("show-nvdash", { clear = true }),
  callback = function()
    local bufs = vim.t.bufs
    if bufs == nil or #bufs ~= 1 then return end

    local lastbuf = bufs[1]
    local lastbuf_name = vim.api.nvim_buf_get_name(lastbuf)

    if lastbuf_name == "" then
      vim.cmd "Nvdash"
      pcall(vim.api.nvim_buf_delete, lastbuf, { force = true })
    end
  end,
})

-- open new buffer to the right of the current one
autocmd("BufAdd", {
  desc = "Open new buffer to the right of the current one",
  group = augroup("open-buffer-right", { clear = true }),
  callback = function(args)
    local new_buf = args.buf
    local anchor_buf = vim.fn.bufnr "#"

    if new_buf == anchor_buf or anchor_buf == -1 or vim.bo[new_buf].buftype ~= "" then return end

    local bufs = vim.t.bufs
    local anchor_idx = -1
    local new_buf_idx = -1

    if bufs == nil then return end

    for i, bufnr in ipairs(bufs) do
      if bufnr == anchor_buf then anchor_idx = i end
      if bufnr == new_buf then new_buf_idx = i end
    end

    if anchor_idx ~= -1 and new_buf_idx ~= -1 and anchor_idx ~= new_buf_idx then
      table.remove(bufs, new_buf_idx)

      -- adjust anchor_idx if new_buf was before it
      if new_buf_idx < anchor_idx then anchor_idx = anchor_idx - 1 end

      table.insert(bufs, anchor_idx + 1, new_buf)

      vim.t.bufs = bufs
    end
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
