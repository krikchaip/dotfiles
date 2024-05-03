---@diagnostic disable: undefined-global

local function view_selection(prompt_bufnr, _)
  local actions = require 'telescope.actions'
  local openfile = require 'nvim-tree.actions.node.open-file'
  local action_state = require 'telescope.actions.state'

  actions.select_default:replace(function()
    actions.close(prompt_bufnr)

    local selection = action_state.get_selected_entry()
    local filename = selection.filename

    if (filename == nil) then
      filename = selection[1]
    end

    openfile.fn('preview', filename)
  end)

  return true
end

local function launch_telescope(func_name, opts)
  local api = require 'nvim-tree.api'
  local telescope_status_ok, _ = pcall(require, 'telescope')

  if not telescope_status_ok then
    return
  end

  local node = api.tree.get_node_under_cursor()
  local is_folder = node.fs_stat and node.fs_stat.type == 'directory' or false
  local basedir = is_folder and node.absolute_path or vim.fn.fnamemodify(node.absolute_path, ':h')

  if (node.name == '..' and TreeExplorer ~= nil) then
    basedir = TreeExplorer.cwd
  end

  opts = opts or {}
  opts.cwd = basedir
  opts.search_dirs = { basedir }
  opts.attach_mappings = view_selection

  return require('telescope.builtin')[func_name](opts)
end

local M = {}

function M.collapse_all()
  require('nvim-tree.api').tree.collapse_all(true)
end

function M.clear_all()
  require('nvim-tree.api').marks.clear()
  require('nvim-tree.api').fs.clear_clipboard()
end

-- Stage git file/folder. If it's already staged, it will instead be unstaged
function M.git_add_toggle()
  local api = require 'nvim-tree.api'

  local node = api.tree.get_node_under_cursor()
  local gs = node.git_status.file

  -- If the current node is a directory get children status
  if gs == nil then
    gs = (node.git_status.dir.direct ~= nil and node.git_status.dir.direct[1])
        or (node.git_status.dir.indirect ~= nil and node.git_status.dir.indirect[1])
  end

  -- If the file is untracked, unstaged or partially staged, we stage it
  if gs == '??' or gs == 'MM' or gs == 'AM' or gs == ' M' then
    vim.cmd('silent !git add ' .. node.absolute_path)
  elseif gs == 'M ' or gs == 'A ' then -- If the file is staged, we unstage
    vim.cmd('silent !git restore --staged ' .. node.absolute_path)
  end

  api.tree.reload()
end

function M.launch_live_grep(opts)
  return launch_telescope('live_grep', opts)
end

function M.launch_find_files(opts)
  return launch_telescope('find_files', opts)
end

function M.change_root_to_global_cwd()
  local api = require 'nvim-tree.api'
  local global_cwd = vim.fn.getcwd(-1, -1)

  api.tree.change_root(global_cwd)
end

return M
