local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts.diff = {
    hide_merge_artifacts = true, -- Hide merge tool temp files (*.orig, *.BACKUP.*, *.BASE.*, *.LOCAL.*, *.REMOTE.*)
    conflict_ours_position = "left", -- Position of ours (:2) in conflict view: "left" or "right"
    conflict_result_height = 33, -- Height of result pane in bottom layout (% of total height)
  }

  opts.explorer = {
    width = 35, -- Width when position is "left" (columns)
    file_filter = {
      -- Glob patterns to hide (e.g., {"*.lock", "dist/*"})
      ignore = { ".git/**", "node_modules/**", "dist/**" },
    },
  }

  opts.keymaps = {
    view = {
      toggle_explorer = "<M-S-e>", -- Toggle explorer visibility (explorer mode only)
      focus_explorer = "<M-e>", -- Focus explorer panel (explorer mode only)
      next_hunk = "]g", -- Jump to next change
      prev_hunk = "[g", -- Jump to previous change
      next_file = "}", -- Next file in explorer/history mode
      prev_file = "{", -- Previous file in explorer/history mode
      open_in_prev_tab = "gf", -- Open current buffer in previous tab (or create one before)
      close_on_open_in_prev_tab = true, -- Close codediff tab after gf opens file in previous tab
      toggle_stage = "<M-s>", -- Stage/unstage current file (works in explorer and diff buffers)
      stage_hunk = "<leader>gs", -- Stage hunk under cursor to git index
      unstage_hunk = "<leader>gu", -- Unstage hunk under cursor from git index
      discard_hunk = "<leader>gr", -- Discard hunk under cursor (working tree only)
      show_help = "<C-/>", -- Show floating window with available keymaps
      toggle_layout = "<leader>gt", -- Toggle between side-by-side and inline layout
    },
    explorer = {
      hover = "I", -- Show file diff preview
      toggle_view_mode = "V", -- Toggle between 'list' and 'tree' views
    },
    history = {
      toggle_view_mode = "V", -- Toggle between 'list' and 'tree' views
    },
    conflict = {
      accept_incoming = "<localleader>al", -- Accept incoming (theirs) change
      accept_current = "<localleader>ar", -- Accept current (ours) change
      accept_both = "<localleader>ab", -- Accept both changes (incoming first)
      discard = "<localleader>db", -- Discard both, keep base
      accept_all_incoming = "<localleader>aL", -- Accept ALL incoming (theirs) changes
      accept_all_current = "<localleader>aR", -- Accept ALL current (ours) changes
      accept_all_both = "<localleader>aB", -- Accept ALL both changes
      discard_all = "<localleader>dB", -- Discard ALL, reset to base
      diffget_incoming = "dlo", -- Get hunk from incoming (theirs) buffer
      diffget_current = "dro", -- Get hunk from current (ours) buffer
    },
  }

  return opts
end

M.setup = function(opts)
  require("codediff").setup(M.config(opts))

  autocmd("User", {
    group = augroup("codediff.settings", { clear = true }),
    pattern = "CodeDiffOpen",
    callback = function()
      for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
        vim.wo[win].number = true
        vim.wo[win].foldlevel = 999
      end
    end,
  })
end

return M
