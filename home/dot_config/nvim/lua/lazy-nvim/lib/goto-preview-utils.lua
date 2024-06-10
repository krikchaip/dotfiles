---@diagnostic disable: param-type-mismatch

local select_to_edit_map = {
  default = 'edit',
  horizontal = 'new',
  vertical = 'vnew',
  tab = 'tabedit',
}

local M = {}

function M.create_key_mapper(bufnr)
  return function(keymaps)
    -- Clear existing floating window keymaps after executing one of them
    local function unmap_keys()
      for _, km in ipairs(keymaps) do
        vim.api.nvim_buf_del_keymap(bufnr, 'n', km[1])
      end
    end

    for _, km in ipairs(keymaps) do
      vim.keymap.set('n', km[1], function()
        km[2]()
        unmap_keys()
      end, { buffer = bufnr, desc = km[3] })
    end
  end
end

function M.create_open_previewer(winnr)
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

return M
