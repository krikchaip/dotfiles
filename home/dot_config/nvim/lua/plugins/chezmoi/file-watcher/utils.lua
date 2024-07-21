local config = require('chezmoi').config
local apply = require 'chezmoi.commands.__apply'
local log = require 'chezmoi.log'
local notify = require 'chezmoi.notify'
local status = require 'chezmoi.commands.__status'

local M = {}

function M.edit_and_apply()
  -- Use autocmd to make it work as if 'watch' option is given
  local bufnr = vim.api.nvim_get_current_buf()
  local force = config.edit.force

  local source_path = vim.api.nvim_buf_get_name(bufnr)
  local event = { 'BufWritePost' }

  local status_err = nil
  status.execute {
    args = {
      '--source-path',
      source_path,
    },
    on_stderr = function(_, data)
      status_err = data
    end,
  }

  if status_err then
    log.warn(status_err)
    return
  end

  local augroup = vim.api.nvim_create_augroup('chezmoi', { clear = false })
  local autocmds = vim.api.nvim_get_autocmds {
    event = event,
    group = augroup,
    buffer = bufnr,
  }

  if #autocmds == 0 and config.notification.on_watch then notify.info 'Edit: This file will be automatically applied' end

  vim.api.nvim_clear_autocmds {
    event = event,
    group = augroup,
    buffer = bufnr,
  }

  vim.api.nvim_create_autocmd(event, {
    group = augroup,
    buffer = bufnr,
    callback = function()
      local args = {
        '--source-path',
        source_path,

        -- had to exclude scripts from auto applying since they take times to execute
        '--exclude',
        'scripts',
      }

      if force then table.insert(args, '--force') end

      apply.execute {
        args = args,
        on_stderr = function(_, data)
          notify.warn(data)
        end,
        on_exit = function(_, apply_exit_code)
          if config.notification.on_apply then
            if apply_exit_code ~= 0 then return end

            notify.info 'Edit: Successfully applied'
          end
        end,
      }
    end,
  })
end

return M
