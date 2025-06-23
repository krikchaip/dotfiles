local M = {}

local map = vim.keymap.set
local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.mappings = {
    go_in = "L",
    go_in_plus = "l",
    go_out = "",
    go_out_plus = "h",
  }

  opts.windows = {
    preview = true,
    width_focus = 30,
    width_preview = 60,
  }

  return opts
end

M.setup = function(opts)
  require("mini.files").setup(M.config(opts))

  -- Snacks.rename integration for mini.files
  -- ref: https://github.com/folke/snacks.nvim/blob/main/docs/rename.md#minifiles
  autocmd("User", {
    group = augroup("mini-files.integration", { clear = true }),
    pattern = "MiniFilesActionRename",
    callback = function(args)
      Snacks.rename.on_rename_file(args.data.from, args.data.to)
    end,
  })

  autocmd("User", {
    group = augroup("mini-files.mappings", { clear = true }),
    pattern = "MiniFilesBufferCreate",
    callback = function(args)
      M.on_attach(args.data.buf_id)
    end,
  })
end

M.on_attach = function(bufnr)
  local function opts(desc)
    return { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
  end

  map("n", "h", M.go_out_plus, opts "Go out of directory plus")
  map("n", "<BS>", M.reset, opts "Reset")
end

-- open and select the current buffer in mini files
-- ref: https://github.com/linkarzu/dotfiles-latest/blob/main/neovim/neobean/lua/plugins/mini-files.lua#L87-L100
M.open = function()
  local MiniFiles = require "mini.files"

  local buf_name = vim.api.nvim_buf_get_name(0)
  local dir_name = vim.fn.fnamemodify(buf_name, ":p:h")

  if vim.fn.filereadable(buf_name) == 1 then
    MiniFiles.open(buf_name, false)
    MiniFiles.reveal_cwd()
  elseif vim.fn.isdirectory(dir_name) == 1 then
    MiniFiles.open(dir_name, false)
    MiniFiles.reveal_cwd()
  else
    MiniFiles.open(nil, false)
  end
end

M.go_out_plus = function()
  local path = (MiniFiles.get_fs_entry() or {}).path

  if path == nil then return end
  if vim.fs.dirname(path) == vim.uv.cwd() then return end

  MiniFiles.go_out()
  MiniFiles.trim_right()
end

M.reset = function()
  MiniFiles.reset()
  MiniFiles.reveal_cwd()
end

return M
