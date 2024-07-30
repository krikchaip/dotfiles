local utils = require 'plugins.telescope.utils'

local M = {}

function M.select_vertical_or_multi(prompt_bufnr)
  local mode = 'vertical'
  utils.select_one_or_multi(mode, prompt_bufnr)
end

function M.select_horizontal_or_multi(prompt_bufnr)
  local mode = 'horizontal'
  utils.select_one_or_multi(mode, prompt_bufnr)
end

function M.select_tab_or_multi(prompt_bufnr)
  local mode = 'tab'
  utils.select_one_or_multi(mode, prompt_bufnr)
end

function M.select_one_or_multi(prompt_bufnr)
  local mode = 'default'
  utils.select_one_or_multi(mode, prompt_bufnr)
end

function M.preview_scrolling_next(prompt_bufnr)
  -- scroll next line
  utils.preview_scroll(prompt_bufnr, 1)
end

function M.preview_scrolling_previous(prompt_bufnr)
  -- scroll previous line
  utils.preview_scroll(prompt_bufnr, -1)
end

function M.reveal_in_nvim_tree(prompt_bufnr)
  local api = require 'nvim-tree.api'
  local actions = require 'telescope.actions'
  local action_state = require 'telescope.actions.state'

  local selection = action_state.get_selected_entry()
  local filename = selection.value or selection.filename or selection[1]
  local filepath = vim.fs.joinpath(selection.cwd, filename)

  actions.close(prompt_bufnr)

  api.tree.find_file { buf = filepath, open = true, focus = true }
end

function M.scope_search_dirs(prompt_bufnr)
  local actions = require 'telescope.actions'
  local action_state = require 'telescope.actions.state'
  local pickers = require 'plugins.telescope.pickers'

  local current_input = action_state.get_current_line()

  actions.close(prompt_bufnr)

  local function select_directories(inner_prompt_bufnr)
    local current_picker = action_state.get_current_picker(inner_prompt_bufnr)
    local selections = current_picker:get_multi_selection()

    local dirs = {}

    if vim.tbl_isempty(selections) then
      table.insert(dirs, action_state.get_selected_entry().value)
    else
      for _, selection in ipairs(selections) do
        table.insert(dirs, selection.value)
      end
    end

    actions.close(inner_prompt_bufnr)

    pickers.workspace_fuzzy_find {
      prompt_title = string.format('Search Under (%s)', table.concat(dirs, ', ')),
      default_text = current_input,
      search_dirs = dirs,
    }
  end

  pickers.find_dirs {
    prompt_title = 'Scope Search Directories',
    attach_mappings = function(_, map)
      map('i', '<CR>', select_directories)
      return true
    end,
  }
end

return M
