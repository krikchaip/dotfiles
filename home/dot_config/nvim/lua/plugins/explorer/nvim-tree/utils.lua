local M = {}

-- Sometimes, we only want to open a tab,
-- but don't want to jump to that tab immediately
function M.open_tab_silent(node)
  local api = require 'nvim-tree.api'

  api.node.open.tab(node)
  vim.cmd.tabprev()
end

-- Search for a file and folder then highlights it in the tree using Telescope
function M.search_node()
  local actions = require 'plugins.telescope.actions'

  require('plugins.telescope.pickers').find_files {
    prompt_title = 'Search Node',
    find_command = { 'fd', '--type', 'file', '--type', 'directory', '--hidden', '--exclude', '**/.git/*' },
    attach_mappings = function(_, map)
      map('i', '<CR>', actions.reveal_in_nvim_tree)
      return true
    end,
  }
end

function M.fuzzy_under_node()
  local api = require 'nvim-tree.api'

  local node = api.tree.get_node_under_cursor()
  if not node then return end

  local is_folder = node.fs_stat and node.fs_stat.type == 'directory' or false
  local basedir = is_folder and node.absolute_path or vim.fn.fnamemodify(node.absolute_path, ':h')

  require('plugins.telescope.pickers').workspace_fuzzy_find {
    prompt_title = string.format('Fuzzy Under Node (%s)', vim.fs.basename(basedir)),
    search_dirs = { basedir },
  }
end

function M.preview_current_node()
  local api = require 'nvim-tree.api'
  local preview = require 'nvim-tree-preview'

  local IMAGE_EXTENSIONS = { 'png', 'svg', 'jpg', 'jpeg', 'gif', 'webp', 'avif' }

  local node = api.tree.get_node_under_cursor()
  if not node then return end

  if vim.tbl_contains(IMAGE_EXTENSIONS, node.extension) then
    api.node.open.horizontal()
    api.tree.open { find_file = true }
    return
  end

  if not preview.is_watching() then
    return preview.watch()
  else
    return preview.node_under_cursor()
  end
end

function M.collapse_all()
  -- `true` is to keep folders containing open buffers expand
  require('nvim-tree.api').tree.collapse_all(true)
end

function M.clear_all()
  require('nvim-tree.api').marks.clear()
  require('nvim-tree.api').fs.clear_clipboard()
end

function M.close_preview()
  local preview = require 'nvim-tree-preview'
  preview.unwatch()
end

--- @param bang? boolean default `false`
function M.close_tree_if_last(bang)
  local original = smart_delete_buffer(bang or false)

  return function()
    local api = require 'nvim-tree.api'

    if not api.tree.is_visible() then return original() end
    if #tabpage_list_normal_wins() > 2 then return original() end

    if #vim.api.nvim_list_tabpages() == 1 then return vim.cmd [[Bdelete]] end

    api.tree.close_in_this_tab()

    return original()
  end
end

function M.toggle_autoreveal()
  vim.g.nvim_tree_autoreveal = not vim.g.nvim_tree_autoreveal
  if vim.g.nvim_tree_autoreveal then require('nvim-tree.api').tree.find_file() end
  vim.notify(string.format('nvim_tree_autoreveal: %s', vim.g.nvim_tree_autoreveal))
end

function M.toggle_copy_single()
  local fs = require('nvim-tree.api').fs

  fs.clear_clipboard()
  fs.copy.node()
end

function M.toggle_cut_single()
  local fs = require('nvim-tree.api').fs

  fs.clear_clipboard()
  fs.cut()
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

function M.change_root_to_global_cwd()
  local api = require 'nvim-tree.api'
  local global_cwd = vim.fn.getcwd(-1, -1)

  api.tree.change_root(global_cwd)
end

-- Sorting files naturally (respecting numbers within files names)
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#sorting-files-naturally-respecting-numbers-within-files-names
function M.sort_by_natural_cmp(nodes)
  local sorter = function(left, right)
    left = left.name:lower()
    right = right.name:lower()

    if left == right then return false end

    for i = 1, math.max(string.len(left), string.len(right)), 1 do
      local l = string.sub(left, i, -1)
      local r = string.sub(right, i, -1)

      if type(tonumber(string.sub(l, 1, 1))) == 'number' and type(tonumber(string.sub(r, 1, 1))) == 'number' then
        local l_number = tonumber(string.match(l, '^[0-9]+'))
        local r_number = tonumber(string.match(r, '^[0-9]+'))

        if l_number ~= r_number then return l_number < r_number end
      elseif string.sub(l, 1, 1) ~= string.sub(r, 1, 1) then
        return l < r
      end
    end
  end

  table.sort(nodes, sorter)
end

return M
