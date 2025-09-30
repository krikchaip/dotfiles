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
    if #bufs == 1 and vim.api.nvim_buf_get_name(bufs[1]) == "" then vim.cmd "Nvdash" end
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

-- Save current view settings on a per-window, per-buffer basis.
local function auto_save_win_view()
  if vim.w.SavedBufView == nil then vim.w.SavedBufView = {} end
  vim.w.SavedBufView[vim.fn.bufnr "%"] = vim.fn.winsaveview()
end

-- Restore current view settings.
local function auto_restore_win_view()
  local buf = vim.fn.bufnr "%"

  if vim.w.SavedBufView ~= nil and vim.w.SavedBufView[buf] ~= nil then
    local v = vim.fn.winsaveview()

    local at_start_of_file = v.lnum == 1 and v.col == 0
    local diff = vim.api.nvim_get_option_value("diff", { win = 0 })

    if at_start_of_file and not diff then vim.fn.winrestview(vim.w.SavedBufView[buf]) end

    vim.w.SavedBufView[buf] = nil
  end
end

local preserve_win_view_group = augroup("preserve-win-view", { clear = true })

autocmd("BufLeave", {
  desc = "Preserve window view when leaving a buffer",
  group = preserve_win_view_group,
  pattern = "*",
  callback = auto_save_win_view,
})

autocmd("BufEnter", {
  desc = "Restore window view when entering a buffer",
  group = preserve_win_view_group,
  pattern = "*",
  callback = auto_restore_win_view,
})
