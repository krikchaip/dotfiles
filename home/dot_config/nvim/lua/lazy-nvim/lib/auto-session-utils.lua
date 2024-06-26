local function bypass_save_by_filetype()
  local file_types_to_bypass = { 'dashboard' }

  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    local buf_ft = vim.api.nvim_get_option_value('filetype', { buf = buf })
    if vim.tbl_contains(file_types_to_bypass, buf_ft) then return true end
  end

  return false
end

local M = {}

M.session_lens_config = {
  -- If load_on_setup is set to false, one needs to eventually call
  -- `require("auto-session").setup_session_lens()` if they want to use session-lens.
  load_on_setup = true,

  previewer = false,

  -- will be passed directly to telescope picker
  theme_conf = {
    border = true,

    attach_mappings = function(_, map)
      local auto_session = require 'auto-session'
      local auto_session_actions = require 'auto-session.session-lens.actions'
      local telescope_actions = require 'telescope.actions'
      local telescope_actions_state = require 'telescope.actions.state'

      -- ref: https://github.com/rmagatti/auto-session/blob/main/lua/auto-session/session-lens/actions.lua#L35
      telescope_actions.select_default:replace(function(prompt_bufnr)
        if prompt_bufnr then telescope_actions.close(prompt_bufnr) end

        local selection = telescope_actions_state.get_selected_entry()
        selection = type(selection) == 'table' and selection.filename or selection

        local dirname = auto_session.format_file_name(selection)
        vim.fn.chdir(dirname)
      end)

      map('i', '<C-c>', auto_session_actions.delete_session)

      return true
    end,
  },
}

-- NOTE: `auto_save_enabled` does not work until `auto_save > in_pager_mode` is fixed.
-- ref: https://github.com/rmagatti/auto-session/blob/main/lua/auto-session/init.lua#L200
--
--     This is simply because of the `opened_with_args` variable,
--     `vim.fn.argv()` returns result from last command's argv()
--     instead of what have started nvim at the beginning.
function M.setup_autosave_session()
  local auto_session = require 'auto-session'

  local group = vim.api.nvim_create_augroup('auto-session-manual', { clear = true })

  vim.api.nvim_create_autocmd('VimLeavePre', {
    desc = 'Auto save the current session before leaving Neovim',
    group = group,
    pattern = '*',
    callback = function()
      if vim.g.in_pager_mode then return end
      if bypass_save_by_filetype() then return end

      local session_dir = vim.loop.cwd()
      vim.notify('Saving Session: ' .. tostring(session_dir))

      auto_session.SaveSession(session_dir, true)
    end,
  })
end

-- replace `cwd_change_handling` option
-- ref: https://github.com/rmagatti/auto-session/blob/main/lua/auto-session/autocmds.lua#L8
function M.setup_dirchanged_session()
  local auto_session = require 'auto-session'

  local group = vim.api.nvim_create_augroup('auto-session-dirchanged', { clear = true })

  vim.schedule(function()
    vim.api.nvim_create_autocmd('DirChangedPre', {
      desc = 'Save current session and clear all buffers/jumps',
      group = group,
      pattern = 'global',
      callback = function()
        -- Don't want to save session if dir change was triggered
        -- by a window change. This will corrupt the session data,
        -- mixing the two different directory sessions
        if vim.v.event.changed_window then return end

        if bypass_save_by_filetype() then return end

        local session_dir = vim.loop.cwd()
        vim.notify('Previous Session: ' .. tostring(session_dir))

        auto_session.SaveSession(session_dir, true)

        -- Clear all buffers and jumps after session save so session
        -- doesn't blead over to next session.
        vim.cmd '%bd!'
        vim.cmd 'clearjumps'

        -- Clear tab names before jumping to another session
        vim.opt.tabline = ''
      end,
    })
  end)

  vim.schedule(function()
    vim.api.nvim_create_autocmd('DirChanged', {
      desc = 'Restore session after pwd has changed',
      group = group,
      pattern = 'global',
      callback = function()
        -- see above
        if vim.v.event.changed_window then return end

        local session_dir = vim.loop.cwd()
        vim.notify('Current Session: ' .. tostring(session_dir))

        ---@diagnostic disable-next-line: param-type-mismatch
        auto_session.RestoreSession(session_dir)

        vim.defer_fn(function()
          -- reload buffers to refresh LSP and other stuff
          vim.cmd 'let curbuf = bufnr() | bufdo e | execute "buffer" curbuf'

          -- rerender tabline for the current session
          vim.cmd 'Lazy reload tabby'
        end, 10)
      end,
    })
  end)
end

function M.load_session(session_dir)
  local auto_session = require 'auto-session'
  local api = require 'nvim-tree.api'

  local bd = smart_delete_buffer()
  local ok = auto_session.RestoreSession(session_dir)

  if not ok then
    bd()
    api.tree.toggle { focus = false }
  end
end

return M
