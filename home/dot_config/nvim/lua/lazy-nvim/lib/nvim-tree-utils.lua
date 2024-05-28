local M = {}

-- Sometimes, we only want to open a tab,
-- but don't want to jump to that tab immediately
function M.open_tab_silent(node)
  local api = require 'nvim-tree.api'

  api.node.open.tab(node)
  vim.cmd.tabprev()
end

-- Search and focus for a file or folder in the tree with Telescope
function M.search_node()
  local api = require 'nvim-tree.api'
  local builtin = require 'telescope.builtin'
  local actions = require 'telescope.actions'
  local action_state = require 'telescope.actions.state'

  local opts = {}

  opts.prompt_title = 'Search Node'
  opts.cwd = vim.fn.getcwd()
  opts.attach_mappings = function(_, map)
    map('i', '<CR>', function(prompt_bufnr)
      actions.close(prompt_bufnr)

      local selection = action_state.get_selected_entry()
      local filename = selection.value or selection.filename or selection[1]
      local filepath = vim.fs.joinpath(selection.cwd, filename)

      api.tree.find_file { buf = filepath }
    end, { desc = 'reveal_node_in_tree' })

    return true
  end

  return builtin.find_files(opts)
end

function M.preview_current_node()
  local preview = require 'nvim-tree-preview'

  if not preview.is_watching() then return preview.watch() end
  preview.node_under_cursor()
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

function M.close_all_nvim_tree()
  local api = require 'nvim-tree.api'
  api.tree.close_in_all_tabs()
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

-- Restore nvim-tree by open it if its buffers are presenting in the session file
function M.restore_nvim_tree()
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
      local buf = vim.api.nvim_win_get_buf(win)
      local bufname = vim.api.nvim_buf_get_name(buf)

      if string.match(bufname, 'NvimTree') then
        local api = require 'nvim-tree.api'
        local view = require 'nvim-tree.view'

        if not view.is_visible() then api.tree.open() end
      end
    end
  end
end

return M
