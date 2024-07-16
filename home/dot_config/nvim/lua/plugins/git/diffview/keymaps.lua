local M = {}

function M.lazy()
  return {
    { '<M-g>', '<cmd>DiffviewOpen<CR>', desc = 'Git: Open Diffview' },
    { '<leader>gd', '<cmd>DiffviewOpen<CR>', desc = 'Git: Open Diffview' },
    { '<leader>gf', '<cmd>DiffviewFileHistory %<CR>', desc = 'Git: Open File History' },
    { '<leader>gf', ':DiffviewFileHistory<CR>', desc = 'Git: Open Line History', mode = 'x' },
    { '<leader>gl', '<cmd>DiffviewFileHistory<CR>', desc = 'Git: Show Logs' },
    { '<leader>gS', '<cmd>DiffviewFileHistory -g --range=stash<CR>', desc = 'Git: Stash' },
  }
end

function M.view()
  local actions = require 'diffview.actions'

  return {
    { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },

    { 'n', 'g?', actions.help 'view', { desc = 'View: Help' } },
    { 'n', '<leader>e', actions.focus_files, { desc = 'View: Focus Panel' } },
    { 'n', 'gf', actions.goto_file_tab, { desc = 'View: Go to File' } },
    { 'n', 'gl', actions.open_commit_log, { desc = 'View: Commit Log' } },

    { 'n', '<Tab>', actions.select_next_entry, { desc = 'Entry: Select Next' } },
    { 'n', '<S-Tab>', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
  }
end

function M.diff_view()
  local actions = require 'diffview.actions'

  return {
    { 'n', '[x', actions.prev_conflict, { desc = 'Merge: Previous Conflict' } },
    { 'n', ']x', actions.next_conflict, { desc = 'Merge: Next Conflict' } },
  }
end

function M.file_panel()
  local actions = require 'diffview.actions'

  return {
    { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },
    { 'n', '<C-r>', actions.refresh_files, { desc = 'Diffview: Refresh' } },

    { 'n', '?', actions.help 'file_panel', { desc = 'Panel: Help' } },
    { 'n', 'l', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
    { 'n', '<Right>', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
    { 'n', 'e', actions.goto_file_tab, { desc = 'Panel: Go to File' } },
    { 'n', 'L', actions.open_commit_log, { desc = 'Panel: Commit Log' } },
    { 'n', 'c', '<cmd>Neogit commit<CR>', { desc = 'Panel: Commit Popup' } },
    { 'n', 'n', '<cmd>Neogit<CR>', { desc = 'Panel: Neogit Popup' } },

    { 'n', 'j', actions.select_next_entry, { desc = 'Entry: Select Next' } },
    { 'n', 'k', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
    { 'n', '<Down>', actions.select_next_entry, { desc = 'Entry: Select Next' } },
    { 'n', '<Up>', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
    { 'n', '<CR>', actions.select_entry, { desc = 'Entry: Select Current' } },
    { 'n', 'X', actions.restore_entry, { desc = 'Entry: Revert Changes' } },
    { 'n', 's', actions.toggle_stage_entry, { desc = 'Entry: Stage / Unstage Current' } },
    { 'n', 'S', actions.stage_all, { desc = 'Entry: Stage All' } },
    { 'n', 'U', actions.unstage_all, { desc = 'Entry: Unstage All' } },

    { 'n', '<M-d>', actions.scroll_view(0.25), { desc = 'View: Scroll Down Half Page' } },
    { 'n', '<M-u>', actions.scroll_view(-0.25), { desc = 'View: Scroll Up Half Page' } },
    { 'n', '<M-j>', actions.scroll_view(1), { desc = 'View: Scroll Down' } },
    { 'n', '<M-k>', actions.scroll_view(-1), { desc = 'View: Scroll Up' } },
  }
end

function M.file_history_panel()
  local actions = require 'diffview.actions'

  return {
    { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },
    { 'n', '<C-r>', actions.refresh_files, { desc = 'Diffview: Refresh' } },
    { 'n', '!', actions.options, { desc = 'Diffview: Open Option Panel' } },

    { 'n', '?', actions.help 'file_history_panel', { desc = 'Panel: Help' } },
    { 'n', 'l', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
    { 'n', '<Right>', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
    { 'n', 'e', actions.goto_file_tab, { desc = 'Panel: Go to File' } },
    { 'n', 'L', actions.open_commit_log, { desc = 'Panel: Commit Log' } },
    { 'n', 'y', actions.copy_hash, { desc = 'Panel: Copy Commit Hash' } },

    { 'n', 'j', actions.select_next_entry, { desc = 'Entry: Select Next' } },
    { 'n', 'k', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
    { 'n', '<Down>', actions.select_next_entry, { desc = 'Entry: Select Next' } },
    { 'n', '<Up>', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
    { 'n', '<CR>', actions.select_entry, { desc = 'Entry: Select Current' } },
    { 'n', 'X', actions.restore_entry, { desc = 'Entry: Revert Changes' } },
    { 'n', 'J', actions.select_next_commit, { desc = 'Entry: Select Next Commit' } },
    { 'n', 'K', actions.select_prev_commit, { desc = 'Entry: Select Previous Commit' } },
    { 'n', '<S-Down>', actions.select_next_commit, { desc = 'Entry: Select Next Commit' } },
    { 'n', '<S-Up>', actions.select_prev_commit, { desc = 'Entry: Select Previous Commit' } },

    { 'n', '<M-d>', actions.scroll_view(0.25), { desc = 'View: Scroll Down Half Page' } },
    { 'n', '<M-u>', actions.scroll_view(-0.25), { desc = 'View: Scroll Up Half Page' } },
    { 'n', '<M-j>', actions.scroll_view(1), { desc = 'View: Scroll Down' } },
    { 'n', '<M-k>', actions.scroll_view(-1), { desc = 'View: Scroll Up' } },
  }
end

function M.option_panel()
  local actions = require 'diffview.actions'

  return {
    { 'n', 'q', actions.close, { desc = 'Option: Close' } },
    { 'n', '?', actions.help 'option_panel', { desc = 'Option: Help' } },
    { 'n', '<Tab>', actions.select_entry, { desc = 'Option: Select' } },
  }
end

function M.help_panel()
  local actions = require 'diffview.actions'

  return {
    { 'n', 'q', actions.close, { desc = 'Help: Close' } },
  }
end

return M
