local M = {}

function M.insert_linewise_eol()
  local api = require 'Comment.api'
  local config = require('Comment.config'):get()

  if vim.fn.mode() == 'n' then return api.insert.linewise.eol(config) end

  -- (assuming insert mode) stop insert mode before executing the command
  vim.cmd 'stopinsert'

  -- doesn't add <Space> to the end
  api.insert.linewise.eol(config)

  -- so we need to add <Space> character manually
  local space = vim.api.nvim_replace_termcodes('<Space>', true, false, true)
  vim.api.nvim_feedkeys(space, 'n', false)
end

function M.toggle_linewise_current()
  local api = require 'Comment.api'
  local config = require('Comment.config'):get()

  api.toggle.linewise.current(config)
end

function M.toggle_blockwise_current()
  local api = require 'Comment.api'
  local config = require('Comment.config'):get()

  api.toggle.blockwise.current(config)
end

return M
