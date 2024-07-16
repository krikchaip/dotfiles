local utils = require 'plugins.editor.auto-session.utils'

require('auto-session').setup {
  -- Enables/disables the plugin's auto save and restore features
  auto_session_enabled = false,

  -- Enables/disables the plugin's session auto creation
  auto_session_create_enabled = false,

  -- Enables/disables auto saving
  auto_save_enabled = false,

  -- Enables/disables auto restoring
  auto_restore_enabled = false,

  -- Use the git branch to differentiate the session name
  auto_session_use_git_branch = false,

  -- Bypass auto save when only buffer open is one of these file types
  bypass_session_save_file_types = nil,

  -- Config for handling the DirChangePre and DirChanged autocmds
  cwd_change_handling = nil,

  pre_save_cmds = {
    utils.close_all_nvim_tree,
  },

  post_restore_cmds = {
    -- Restore nvim-tree if possible after restoring another buffers
    -- utils.restore_nvim_tree,
  },

  -- custom session lens config (telescope)
  session_lens = utils.session_lens_config,
}

utils.setup_autosave_session()
utils.setup_dirchanged_session()
