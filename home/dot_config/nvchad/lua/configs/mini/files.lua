local M = {}

local map = vim.keymap.set
local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

---@type table<string,table<string,boolean>>
local ignored = {}

---@type table<string,string>
local fs_type = {}

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

  autocmd("User", {
    group = augroup("mini-files.mappings", { clear = true }),
    pattern = "MiniFilesBufferCreate",
    callback = function(args)
      M.on_attach(args.data.buf_id)
    end,
  })

  -- Snacks.rename integration for mini.files
  -- ref: https://github.com/folke/snacks.nvim/blob/main/docs/rename.md#minifiles
  autocmd("User", {
    group = augroup("mini-files.rename", { clear = true }),
    pattern = "MiniFilesActionRename",
    callback = function(args)
      Snacks.rename.on_rename_file(args.data.from, args.data.to)
    end,
  })

  autocmd("User", {
    group = augroup("mini-files.preview", { clear = true }),
    pattern = "MiniFilesWindowUpdate",
    callback = function(args)
      local bufnr, winnr = args.data.buf_id, args.data.win_id

      local bufname = vim.api.nvim_buf_get_name(bufnr)
      local filepath = bufname:match "^minifiles://%d+/(/.+)$"

      -- Snacks.image integration for mini.files preview window
      -- ref: ChatGPT 🤪
      if Snacks.image.supports(filepath) then
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, {})
        vim.api.nvim_win_set_height(winnr, 15)

        Snacks.image.placement.new(bufnr, filepath, { inline = true })

        return
      end

      -- set preview window options
      if M.fs_type(filepath) == "file" then
        vim.bo[bufnr].buftype = "nowrite"
        vim.wo[winnr].number = true
        vim.wo[winnr].signcolumn = "yes"

        return
      end

      -- set options for the rest of windows
      vim.wo[winnr].cursorline = true
    end,
  })
end

M.on_attach = function(bufnr)
  local function opts(desc, more_opts)
    local base_opts = { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
    more_opts = more_opts or {}

    return vim.tbl_deep_extend("force", base_opts, more_opts)
  end

  map("n", "<Up>", "<Up>", opts())
  map("n", "<Down>", "<Down>", opts())

  map("n", "<Esc>", MiniFiles.close, opts "Close (Esc)")
  map("n", "<S-Right>", MiniFiles.go_in, opts "Go in entry (Arrow)")
  map("n", "<Right>", M.go_in_plus, opts "Go in entry plus (Arrow)")
  map("n", "<S-Enter>", MiniFiles.go_in, opts "Go in entry (Enter)")
  map("n", "<Enter>", M.go_in_plus, opts "Go in entry plus (Enter)")
  map("n", "h", M.go_out_plus, opts "Go out of directory plus")
  map("n", "<Left>", M.go_out_plus, opts "Go out of directory plus (Arrow)")
  map("n", ",", "''", opts("Go to latest jump", { remap = true }))
  map("n", "<BS>", M.reset, opts "Reset")
  map("n", "f", M.search_node, opts "Search node")
  map("n", "=", M.sync, opts "Synchronize")

  map("n", "<C-x>", M.split "horizontal", opts "Split horizontally")
  map("n", "<C-v>", M.split "vertical", opts "Split vertically")
  map("n", "<C-t>", M.split "tab", opts "Split tab")

  map("n", "ya", M.copy_absolute, opts "Copy absolute path")
  map("n", "yr", M.copy_relative, opts "Copy relative path")
end

M.open = function()
  local MiniFiles = require "mini.files"
  MiniFiles.open(MiniFiles.get_latest_path())
end

-- open and select the current buffer in mini files
-- ref: https://github.com/linkarzu/dotfiles-latest/blob/main/neovim/neobean/lua/plugins/mini-files.lua#L87-L100
M.open_reveal = function()
  local MiniFiles = require "mini.files"

  local buf_name = vim.api.nvim_buf_get_name(0)
  local dir_name = vim.fn.fnamemodify(buf_name, ":p:h")

  local root = vim.uv.cwd()
  local in_root = buf_name:sub(1, #root) == root

  if in_root and vim.fn.filereadable(buf_name) == 1 then
    MiniFiles.open(buf_name)
  elseif in_root and vim.fn.isdirectory(dir_name) == 1 then
    MiniFiles.open(dir_name)
  else
    M.open()
  end

  -- M.reset()
end

M.go_in_plus = function()
  MiniFiles.go_in { close_on_file = true }
end

M.go_out_plus = function()
  local state = MiniFiles.get_explorer_state()
  if state == nil then return end

  local path = state.branch[state.depth_focus]
  local cwd = vim.uv.cwd()

  if path ~= cwd then
    MiniFiles.go_out()
    MiniFiles.trim_right()
  end
end

M.reset = function()
  MiniFiles.reset()
  -- MiniFiles.reveal_cwd()
end

M.search_node = function()
  local cwd = vim.uv.cwd()
  local find_command = require("configs.telescope").config().pickers.find_files.find_command

  table.insert(find_command, "--type")
  table.insert(find_command, "directory")

  local function select_default(prompt_bufnr)
    local selection = require("telescope.actions.state").get_selected_entry()
    local filename = selection.value or selection.filename or selection[1]
    local filepath = vim.fs.joinpath(selection.cwd, filename)

    require("telescope.actions").close(prompt_bufnr)
    require("mini.files").open(filepath)

    M.reset()
  end

  local function close(prompt_bufnr)
    require("telescope.actions").close(prompt_bufnr)
    M.open()
  end

  require("mini.files").close()
  require("telescope.builtin").find_files {
    prompt_title = "Search Node",
    cwd = cwd,
    find_command = find_command,
    attach_mappings = function(_, picker_map)
      picker_map("i", "<CR>", select_default)
      picker_map("i", "<ESC>", close)
      picker_map("i", "<C-q>", close)
      return true
    end,
  }
end

M.sync = function()
  if MiniFiles.synchronize() then M.reset_cache() end
end

M.split = function(direction)
  local direction_cmd = {
    horizontal = "new",
    vertical = "vnew",
    tab = "tabedit",
  }

  return function()
    local target = MiniFiles.get_explorer_state().target_window
    local path = MiniFiles.get_fs_entry().path

    target = vim.api.nvim_win_call(target, function()
      vim.cmd(string.format("%s %s", direction_cmd[direction], path))
      return vim.api.nvim_get_current_win()
    end)

    MiniFiles.set_target_window(target)
    MiniFiles.go_in { close_on_file = true }
  end
end

M.copy_absolute = function()
  local path = (MiniFiles.get_fs_entry() or {}).path
  if not path then return vim.notify "Cursor is not on valid entry" end

  vim.fn.setreg("+", path)
  vim.notify("Copied absolute path: " .. path)
end

M.copy_relative = function()
  local path = (MiniFiles.get_fs_entry() or {}).path
  if not path then return vim.notify "Cursor is not on valid entry" end

  local relative_path = vim.fn.fnamemodify(path, ":.")

  vim.fn.setreg("+", relative_path)
  vim.notify("Copied relative path: " .. relative_path)
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
  if #entries > 0 then
    local entry = entries[1]
    local modifier = entry.fs_type == "file" and ":p:h" or ":h"
    local dir_name = vim.fn.fnamemodify(entry.path, modifier)

    if ignored[dir_name] == nil then
      local paths = vim.tbl_map(function(e)
        return e.path
      end, entries)

      ignored[dir_name] = Git.CheckIgnore(paths)
    end
  end

  return function(e)
    local mod = e.fs_type == "file" and ":p:h" or ":h"
    local parent = vim.fn.fnamemodify(e.path, mod)
    return ignored[parent] == nil or not ignored[parent][e.path]
  end
end

M.exclude = function(pattern)
  return function(entry)
    return entry.path:find(pattern) == nil
  end
end

M.reset_cache = function()
  ignored = {}
  fs_type = {}
end

M.fs_type = function(path)
  local type = fs_type[path]
  if type ~= nil then return type end

  type = vim.uv.fs_stat(path).type
  fs_type[path] = type

  return type
end

return M
