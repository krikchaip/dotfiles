local M = {}

local map = vim.keymap.set
local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

---@type table<string,boolean>|nil
local ignored = nil

M.config = function(opts)
  opts.content = {
    sort = M.sorter,
  }

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

  map("n", "<Up>", "<Up>", opts())
  map("n", "<Down>", "<Down>", opts())

  map("n", "<S-Right>", MiniFiles.go_in, opts "Go in entry (Arrow)")
  map("n", "<Right>", M.go_in_plus, opts "Go in entry plus (Arrow)")
  map("n", "<S-Enter>", MiniFiles.go_in, opts "Go in entry (Enter)")
  map("n", "<Enter>", M.go_in_plus, opts "Go in entry plus (Enter)")
  map("n", "h", M.go_out_plus, opts "Go out of directory plus")
  map("n", "<Left>", M.go_out_plus, opts "Go out of directory plus (Arrow)")
  map("n", "<BS>", M.reset, opts "Reset")
  map("n", "=", M.sync, opts "Synchronize")
end

-- open and select the current buffer in mini files
-- ref: https://github.com/linkarzu/dotfiles-latest/blob/main/neovim/neobean/lua/plugins/mini-files.lua#L87-L100
M.open = function()
  local MiniFiles = require "mini.files"

  local buf_name = vim.api.nvim_buf_get_name(0)
  local dir_name = vim.fn.fnamemodify(buf_name, ":p:h")

  local root = vim.uv.cwd()
  local in_root = buf_name:sub(1, #root) == root

  if in_root and vim.fn.filereadable(buf_name) == 1 then
    MiniFiles.open(buf_name, false)
    MiniFiles.reveal_cwd()
  elseif in_root and vim.fn.isdirectory(dir_name) == 1 then
    MiniFiles.open(dir_name, false)
    MiniFiles.reveal_cwd()
  else
    M.open_root()
  end
end

M.open_root = function()
  require("mini.files").open()
end

M.go_in_plus = function()
  MiniFiles.go_in { close_on_file = true }
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

M.sync = function()
  if not MiniFiles.synchronize() then return end

  ---@diagnostic disable-next-line: lowercase-global
  output = nil
end

M.sorter = function(entries)
  local filters = M.combine_filters { M.gitignore(entries), M.exclude "%.git$" }
  entries = vim.tbl_filter(filters, entries)

  return MiniFiles.default_sort(entries)
end

M.combine_filters = function(...)
  local filters = ...

  return function(entry)
    for _, f in ipairs(filters) do
      if not f(entry) then return false end
    end

    return true
  end
end

-- gitignore filter
-- ref: https://www.reddit.com/r/neovim/comments/17v3vec/has_anybody_setup_gitignore_filter_for_minifiles
M.gitignore = function(entries)
  if ignored == nil then
    local paths = vim.tbl_map(function(e)
      return e.path
    end, entries)

    ignored = Git.CheckIgnore(paths)
  end

  return function(entry)
    return not ignored[entry.path]
  end
end

M.exclude = function(pattern)
  return function(entry)
    return entry.path:find(pattern) == nil
  end
end

return M
