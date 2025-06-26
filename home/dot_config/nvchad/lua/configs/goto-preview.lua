local M = {}

local map = vim.keymap.set
local nomap = vim.api.nvim_buf_del_keymap
local get_buf = vim.api.nvim_get_current_buf
local get_buf_name = vim.api.nvim_buf_get_name
local get_win_config = vim.api.nvim_win_get_config
local get_win_cursor = vim.api.nvim_win_get_cursor
local set_win = vim.api.nvim_set_current_win
local set_win_cursor = vim.api.nvim_win_set_cursor
local close_win = vim.api.nvim_win_close

M.config = function(opts)
  opts.zindex = 10
  opts.vim_ui_input = false

  opts.lsp_configs = { get_config = M.get_config }
  opts.post_open_hook = M.post_open_hook

  return opts
end

M.setup = function()
  require("goto-preview").setup(M.config {})
end

M.get_config = function(data)
  local uri, range

  if data.params then
    local response = vim.lsp.buf_request_sync(0, data.method, data.params)[1]
    data = response.result[1] or response.result
  end

  uri = data.targetUri or data.uri
  range = (data.targetRange or data.range).start

  return uri, { range.line + 1, range.character }
end

M.post_open_hook = function(bufnr, winnr)
  local function opts(desc)
    return { buffer = bufnr, desc = "Preview: " .. desc }
  end

  M.map {
    { "n", "q", M.close, opts "Close Current" },
    { "n", "Q", M.close_all, opts "Close All" },

    { "n", "<CR>", M.open_preview(winnr, "default"), opts "Open Buffer" },
    { "n", "<C-x>", M.open_preview(winnr, "horizontal"), opts "Split Horizontally" },
    { "n", "<C-v>", M.open_preview(winnr, "vertical"), opts "Split Vertically" },
    { "n", "<C-t>", M.open_preview(winnr, "tab"), opts "Open in a new Tab" },
  }
end

M.map = function(mappings)
  local function once(fn)
    return function()
      local buf = get_buf()

      for _, args in ipairs(mappings) do
        nomap(buf, args[1], args[2])
      end

      fn()
    end
  end

  for _, args in ipairs(mappings) do
    map(args[1], args[2], once(args[3]), args[4])
  end
end

M.close = function()
  vim.cmd "wincmd q"
end

M.close_all = function()
  require("goto-preview").close_all_win()
end

-- Open preview window using telescope-esque bindings
-- ref: https://github.com/rmagatti/goto-preview/wiki/Advanced-Configurations
M.open_preview = function(preview_win, type)
  local gtp = require "goto-preview"

  local select_to_edit_map = {
    default = "edit",
    horizontal = "new",
    vertical = "vnew",
    tab = "tabedit",
  }

  return function()
    local command = select_to_edit_map[type]

    local orig_window = get_win_config(preview_win).win
    local cursor_position = get_win_cursor(preview_win)
    local filename = get_buf_name(0)

    close_win(preview_win, gtp.conf.force_close)
    M.open_file(orig_window, filename, cursor_position, command)
  end
end

M.open_file = function(orig_window, filename, cursor_position, command)
  if orig_window ~= 0 and orig_window ~= nil then set_win(orig_window) end

  ---@diagnostic disable-next-line: param-type-mismatch
  pcall(vim.cmd, string.format("%s %s", command, filename))

  set_win_cursor(0, cursor_position)
end

return M
