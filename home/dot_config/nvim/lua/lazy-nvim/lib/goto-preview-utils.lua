---@diagnostic disable: param-type-mismatch

local select_to_edit_map = {
  default = 'edit',
  horizontal = 'new',
  vertical = 'vnew',
  tab = 'tabedit',
}

local M = {}

function M.create_open_preview(winnr)
  return function(layout)
    return function()
      local gtp = require 'goto-preview'

      local command = select_to_edit_map[layout]

      local orig_window = vim.api.nvim_win_get_config(winnr).win
      local cursor_position = vim.api.nvim_win_get_cursor(winnr)
      local filename = vim.api.nvim_buf_get_name(0)

      -- Closes the current floating window before creating new one
      vim.api.nvim_win_close(winnr, gtp.conf.force_close)

      if orig_window ~= 0 and orig_window ~= nil then vim.api.nvim_set_current_win(orig_window) end
      pcall(vim.cmd, string.format('%s %s', command, filename))
      vim.api.nvim_win_set_cursor(0, cursor_position)
    end
  end
end

-- Clear existing floating window keymaps
function M.clear_buffer_keymaps(bufnr)
  vim.api.nvim_buf_del_keymap(bufnr, 'n', 'q')
  vim.api.nvim_buf_del_keymap(bufnr, 'n', 'Q')
  vim.api.nvim_buf_del_keymap(bufnr, 'n', '<CR>')
  vim.api.nvim_buf_del_keymap(bufnr, 'n', '<C-s>')
  vim.api.nvim_buf_del_keymap(bufnr, 'n', '<C-v>')
  vim.api.nvim_buf_del_keymap(bufnr, 'n', '<C-t>')
end

return M
