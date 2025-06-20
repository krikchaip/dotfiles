local M = {}

local map = vim.keymap.set
local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.on_attach = M.on_attach

  opts.select_prompts = true
  opts.reload_on_bufenter = true

  opts.view.centralize_selection = true

  opts.renderer.full_name = true
  opts.renderer.indent_width = 1
  opts.renderer.indent_markers.enable = false
  opts.renderer.highlight_diagnostics = "name"
  opts.renderer.icons.web_devicons = { folder = { enable = true } }

  opts.update_focused_file.enable = false

  opts.diagnostics = { enable = true, show_on_dirs = true }

  -- hide .git directory
  -- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Tips#hide-git-directory
  opts.filters.custom = { "^.git$" }

  opts.live_filter = { always_show_folders = false }

  opts.actions = {
    change_dir = { enable = false },
    expand_all = { exclude = { ".git", "target", "build" } },
    open_file = { window_picker = { enable = false } },
  }

  opts.help = { sort_by = "desc" }

  return opts
end

M.setup = function(opts)
  require("nvim-tree").setup(M.config(opts))

  vim.g.auto_reveal = true

  autocmd("BufEnter", {
    desc = "Auto reveal current buffer in Nvim-tree",
    group = augroup("nvim-tree-autoreveal", { clear = true }),
    callback = function()
      if not vim.g.auto_reveal then return end
      require("nvim-tree.api").tree.find_file()
    end,
  })

  autocmd("TabEnter", {
    desc = "Reload Nvim-tree after entering a tab page",
    group = augroup("nvim-tree-tabpage", { clear = true }),
    callback = function()
      require("nvim-tree.api").tree.reload()
    end,
  })

  local events = require("nvim-tree.api").events

  local prev = { old_name = "", new_name = "" }

  -- Snacks.rename integration for nvim-tree
  -- ref: https://github.com/folke/snacks.nvim/blob/main/docs/rename.md#nvim-tree
  events.subscribe(events.Event.NodeRenamed, function(data)
    if prev.new_name ~= data.new_name or prev.old_name ~= data.old_name then
      prev = data
      Snacks.rename.on_rename_file(data.old_name, data.new_name)
    end
  end)
end

M.on_attach = function(bufnr)
  local api = require "nvim-tree.api"

  local tree = api.tree
  local node = api.node
  local fs = api.fs
  local live_filter = api.live_filter
  local marks = api.marks

  local function opts(desc)
    return { desc = desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
  end

  -- explorer
  map("n", "<C-/>", tree.toggle_help, opts "Explorer: Toggle Help")
  map("n", "q", tree.close, opts "Explorer: Close Tree")
  map("n", "<C-r>", tree.reload, opts "Explorer: Refresh Tree")
  map("n", "<BS>", node.navigate.parent_close, opts "Explorer: Close Directory")
  map("n", "<S-BS>", tree.collapse_all, opts "Explorer: Collapse All")
  map("n", "E", tree.expand_all, opts "Explorer: Expand All")
  map("n", "n", fs.create, opts "Explorer: New Node")
  map("n", "D", fs.remove, opts "Explorer: Delete Node")
  map("n", "dd", fs.remove, opts "Explorer: Delete Node")
  map("n", "dt", fs.trash, opts "Explorer: Trash Node")
  map("n", "e", node.run.cmd, opts "Explorer: Run Command at Node")

  -- open node
  map("n", "l", node.open.edit, opts "Open: Selected Node")
  map("n", "<Right>", node.open.edit, opts "Open: Selected Node")
  map("n", "<CR>", node.open.edit, opts "Open: Selected Node")
  map("n", "<2-LeftMouse>", node.open.edit, opts "Open: Selected Node")
  map("n", "o", node.run.system, opts "Open: System Default")
  map("n", "<M-RightMouse>", node.run.system, opts "Open: System Default")
  map("n", "x", node.open.horizontal, opts "Open: Horizontal Split")
  map("n", "v", node.open.vertical, opts "Open: Vertical Split")
  map("n", "t", node.open.tab, opts "Open: New Tab")
  map("n", "p", node.open.preview, opts "Open: Preview Node")
  map("n", "i", node.show_info_popup, opts "Open: Node Info")

  -- navigation
  map("n", "h", node.navigate.parent, opts "Navigate: Parent Directory")
  map("n", "<Left>", node.navigate.parent, opts "Navigate: Parent Directory")
  map("n", "{", node.navigate.sibling.prev, opts "Navigate: Previous Sibling")
  map("n", "}", node.navigate.sibling.next, opts "Navigate: Next Sibling")

  -- copy
  map("n", "Y", fs.copy.filename, opts "Copy: Filename")
  map("n", "yy", fs.copy.filename, opts "Copy: Filename")
  map("n", "yr", fs.copy.relative_path, opts "Copy: Relative Path")
  map("n", "ya", fs.copy.absolute_path, opts "Copy: Absolute Path")
  map("n", "yb", fs.copy.basename, opts "Copy: Basename")

  -- rename
  map("n", "R", fs.rename, opts "Rename: Filename")
  map("n", "rr", fs.rename, opts "Rename: Filename")
  map("n", "rf", fs.rename_sub, opts "Rename: Full Name")
  map("n", "ra", fs.rename_full, opts "Rename: Full Path")
  map("n", "rb", fs.rename_basename, opts "Rename: Basename")

  -- search
  map("n", "f", M.search_node, opts "Search: Node")
  map("n", "\\f", live_filter.start, opts "Search: Start Filter")
  map("n", "\\F", live_filter.clear, opts "Search: Clear Filter")

  -- filters
  map("n", "\\a", tree.toggle_enable_filters, opts "Filter: Toggle All")
  map("n", "\\m", tree.toggle_no_bookmark_filter, opts "Filter: Toggle Marks")
  map("n", "\\b", tree.toggle_no_buffer_filter, opts "Filter: Toggle Buffers")
  map("n", "\\c", tree.toggle_git_clean_filter, opts "Filter: Toggle Git Clean")
  map("n", "\\i", tree.toggle_gitignore_filter, opts "Filter: Toggle Git Ignore")
  map("n", "\\.", tree.toggle_hidden_filter, opts "Filter: Toggle Dotfiles")
  map("n", "\\h", tree.toggle_custom_filter, opts "Filter: Toggle Hidden")

  -- marks
  map("n", ".", marks.toggle, opts "Mark: Toggle")
  map("n", "c", fs.copy.node, opts "Mark: Toggle Copy")
  map("n", "X", fs.cut, opts "Mark: Toggle Cut")
  map("n", "P", fs.paste, opts "Mark: Paste Selected")
  map("n", "M", M.clear_all, opts "Mark: Clear All")
  map("n", "mm", M.clear_all, opts "Mark: Clear All")
  map("n", "mp", marks.bulk.move, opts "Mark: Move Selected")
  map("n", "md", marks.bulk.delete, opts "Mark: Delete Selected")
  map("n", "mt", marks.bulk.trash, opts "Mark: Trash Selected")

  -- diagnostic
  map("n", "[d", node.navigate.diagnostics.prev_recursive, opts "Diagnostic: Previous")
  map("n", "]d", node.navigate.diagnostics.next_recursive, opts "Diagnostic: Next")

  -- git
  map("n", "[g", node.navigate.git.prev_recursive, opts "Git: Previous Change")
  map("n", "]g", node.navigate.git.next_recursive, opts "Git: Next Change")
  map("n", "s", M.git_add_toggle, opts "Git: Toggle Stage")
end

M.search_node = function()
  local cwd = vim.uv.cwd()
  local find_command = require("configs.telescope").config().pickers.find_files.find_command

  table.insert(find_command, "--type")
  table.insert(find_command, "directory")

  vim.print(find_command)

  local function select_default(prompt_bufnr)
    local selection = require("telescope.actions.state").get_selected_entry()
    local filename = selection.value or selection.filename or selection[1]
    local filepath = vim.fs.joinpath(selection.cwd, filename)

    require("telescope.actions").close(prompt_bufnr)
    require("nvim-tree.api").tree.find_file { buf = filepath, open = true, focus = true }
  end

  require("telescope.builtin").find_files {
    prompt_title = "Search Node",
    cwd = cwd,
    find_command = find_command,
    attach_mappings = function(_, picker_map)
      picker_map("i", "<CR>", select_default)
      return true
    end,
  }
end

M.clear_all = function()
  require("nvim-tree.api").marks.clear()
  require("nvim-tree.api").fs.clear_clipboard()
end

-- Stage git file/folder. If it's already staged, it will instead be unstaged
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#git-stage-unstage-files-and-directories-from-the-tree
M.git_add_toggle = function()
  local api = require "nvim-tree.api"

  local node = api.tree.get_node_under_cursor()
  local gs = node.git_status.file

  -- If the current node is a directory get children status
  if gs == nil then
    gs = (node.git_status.dir.direct ~= nil and node.git_status.dir.direct[1])
      or (node.git_status.dir.indirect ~= nil and node.git_status.dir.indirect[1])
  end

  -- If the file is untracked, unstaged or partially staged, we stage it
  if gs == "??" or gs == "MM" or gs == "AM" or gs == " M" then
    vim.cmd("silent !git add " .. node.absolute_path)
  elseif gs == "M " or gs == "A " then -- If the file is staged, we unstage
    vim.cmd("silent !git restore --staged " .. node.absolute_path)
  end

  api.tree.reload()
end

return M
