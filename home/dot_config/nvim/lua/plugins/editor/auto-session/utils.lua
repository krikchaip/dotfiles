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

  previewer = true,

  -- will be passed directly to telescope picker
  theme_conf = {
    border = true,
    borderchars = { '─', '│', '─', '│', '╭', '╮', '╯', '╰' },

    layout_strategy = 'vertical',
    layout_config = {
      vertical = {
        prompt_position = 'top',
        mirror = true,
        width = { 0.8, max = 90 },
        height = { 0.8, max = 37 },
        preview_height = { 0, min = 20 },
      },
    },

    attach_mappings = function(_, map)
      local auto_session_actions = require 'auto-session.session-lens.actions'
      local telescope_actions = require 'telescope.actions'
      local telescope_actions_state = require 'telescope.actions.state'

      -- ref: https://github.com/rmagatti/auto-session/blob/main/lua/auto-session/session-lens/actions.lua#L45
      telescope_actions.select_default:replace(function(prompt_bufnr)
        local selection = telescope_actions_state.get_selected_entry()

        if not selection then return end
        if prompt_bufnr then telescope_actions.close(prompt_bufnr) end

        vim.fn.chdir(selection.value)
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
  local tabby = require 'plugins.ui.tabline.tabby.utils'

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

        auto_session.SaveSession(session_dir, true)

        -- Clear all buffers and jumps after session save so session
        -- doesn't blead over to next session.
        vim.cmd '%bd!'
        vim.cmd 'clearjumps'
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

        auto_session.RestoreSession(session_dir)

        -- clear previous tab names and replace with current session tab names
        tabby.restore_tab_names()

        vim.defer_fn(function()
          -- reload buffers to refresh LSP and other stuff
          vim.cmd 'let curbuf = bufnr() | bufdo silent! e | execute "buffer" curbuf'
        end, 20)
      end,
    })
  end)
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

function M.close_all_nvim_tree()
  local api = require 'nvim-tree.api'
  api.tree.close_in_all_tabs()
end

return M
