--- @diagnostic disable: param-type-mismatch

local edit_file_cmd_map = {
  vertical = 'vsplit',
  horizontal = 'split',
  tab = 'tabedit',
  default = 'edit',
}

local edit_buf_cmd_map = {
  vertical = 'vert sbuffer',
  horizontal = 'sbuffer',
  tab = 'tab sbuffer',
  default = 'buffer',
}

-- ref: https://github.com/nvim-telescope/telescope.nvim/issues/1048#issuecomment-1227591722
local function select_one_or_multi(method, prompt_bufnr)
  local picker = require('telescope.actions.state').get_current_picker(prompt_bufnr)
  local multi_selection = picker:get_multi_selection()

  if #multi_selection > 1 then
    require('telescope.pickers').on_close_prompt(prompt_bufnr)
    pcall(vim.api.nvim_set_current_win, picker.original_win_id)

    for _, entry in ipairs(multi_selection) do
      local filename, row, col

      if entry.path or entry.filename then
        filename = entry.path or entry.filename

        row = entry.row or entry.lnum
        col = vim.F.if_nil(entry.col, 1)
      elseif not entry.bufnr then
        local value = entry.value
        if not value then return end

        if type(value) == 'table' then value = entry.display end

        local sections = vim.split(value, ':')

        filename = sections[1]
        row = tonumber(sections[2])
        col = tonumber(sections[3])
      end

      local entry_bufnr = entry.bufnr

      if entry_bufnr then
        if not vim.api.nvim_get_option_value('buflisted', { buf = entry_bufnr }) then
          vim.api.nvim_set_option_value('buflisted', true, { buf = entry_bufnr })
        end

        -- local command = i == 1 and 'buffer' or edit_buf_cmd_map[method]
        local command = edit_buf_cmd_map[method]

        pcall(vim.cmd, string.format('%s %s', command, vim.api.nvim_buf_get_name(entry_bufnr)))
      else
        -- local command = i == 1 and 'edit' or edit_file_cmd_map[method]
        local command = edit_file_cmd_map[method]

        if vim.api.nvim_buf_get_name(0) ~= filename or command ~= 'edit' then
          filename = require('plenary.path'):new(vim.fn.fnameescape(filename)):normalize(vim.loop.cwd())
          pcall(vim.cmd, string.format('%s %s', command, filename))
        end
      end

      if row and col then pcall(vim.api.nvim_win_set_cursor, 0, { row, col - 1 }) end
    end
  else
    require('telescope.actions')['select_' .. method](prompt_bufnr)
  end
end

-- ref: https://github.com/nvim-telescope/telescope.nvim/issues/2602
local function preview_scroll(prompt_bufnr, direction)
  local previewer = require('telescope.actions.state').get_current_picker(prompt_bufnr).previewer
  local status = require('telescope.state').get_status(prompt_bufnr)

  -- Check if we actually have a previewer and a preview window
  if type(previewer) ~= 'table' or previewer.scroll_fn == nil or status.preview_win == nil then return end

  previewer:scroll_fn(1 * direction)
end

local M = {}

function M.select_vertical_or_multi(prompt_bufnr) select_one_or_multi('vertical', prompt_bufnr) end

function M.select_horizontal_or_multi(prompt_bufnr) select_one_or_multi('horizontal', prompt_bufnr) end

function M.select_tab_or_multi(prompt_bufnr) select_one_or_multi('tab', prompt_bufnr) end

function M.select_one_or_multi(prompt_bufnr) select_one_or_multi('default', prompt_bufnr) end

function M.preview_scrolling_next(prompt_bufnr) preview_scroll(prompt_bufnr, 1) end

function M.preview_scrolling_previous(prompt_bufnr) preview_scroll(prompt_bufnr, -1) end

return M
