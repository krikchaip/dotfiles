return {
  -- Adds git related signs to the gutter, as well as utilities for managing changes
  -- ref: https://github.com/lewis6991/gitsigns.nvim?tab=readme-ov-file
  {
    'lewis6991/gitsigns.nvim',
    name = 'gitsigns',
    version = '^0.8.0',
    cond = function() return is_git_repo() or is_git_file() end,
    event = { 'BufReadPost', 'BufNewFile' },
    opts = {
      signs = {
        add = { text = '┃' },
        change = { text = '┃' },
        delete = { text = '⏵' },
        topdelete = { text = '⏵' },
        changedelete = { text = '~' },
        untracked = { text = '┆' },
      },

      attach_to_untracked = true,

      signcolumn = true, -- Toggle with `:Gitsigns toggle_signs`
      numhl = true, -- Toggle with `:Gitsigns toggle_numhl`
      linehl = false, -- Toggle with `:Gitsigns toggle_linehl`
      word_diff = false, -- Toggle with `:Gitsigns toggle_word_diff`
      current_line_blame = true, -- Toggle with `:Gitsigns toggle_current_line_blame`

      current_line_blame_opts = {
        virt_text_pos = 'eol', -- 'eol' | 'overlay' | 'right_align'
        virt_text_priority = 1000,
        delay = 500,
        ignore_whitespace = true,
      },

      current_line_blame_formatter = '     <author>, <author_time:%R> · <summary>',
      current_line_blame_formatter_opts = {
        relative_time = true,
      },

      on_attach = function(bufnr)
        local gitsigns = require 'gitsigns'
        local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        -- set buffer to `0` or `true` for current buffer
        local kopts = { buffer = bufnr, silent = true }

        -- [[ Navigation ]]

        local next_hunk, prev_hunk = ts_repeat_move.make_repeatable_move_pair(function()
          if vim.wo.diff then
            vim.cmd.normal { ']c', bang = true }
          else
            gitsigns.nav_hunk('next', { preview = false })
          end
        end, function()
          if vim.wo.diff then
            vim.cmd.normal { '[c', bang = true }
          else
            gitsigns.nav_hunk('prev', { preview = false })
          end
        end)

        kopts.desc = 'Git: Next unstaged hunk'
        vim.keymap.set('n', ']c', next_hunk, kopts)

        kopts.desc = 'Git: Previous unstaged hunk'
        vim.keymap.set('n', '[c', prev_hunk, kopts)

        -- [[ Menus ]]

        kopts.desc = 'Git: Show line info'
        vim.keymap.set('n', '<leader>gi', function() gitsigns.blame_line { full = true } end, kopts)

        -- [[ Actions ]]

        kopts.desc = 'Git: Stage hunk under cursor'
        vim.keymap.set('n', '<leader>ghs', function() gitsigns.stage_hunk() end, kopts)

        kopts.desc = 'Git: Stage highlighted hunk'
        vim.keymap.set('v', '<leader>ghs', function() gitsigns.stage_hunk { vim.fn.line '.', vim.fn.line 'v' } end, kopts)

        kopts.desc = 'Git: Stage all hunks'
        vim.keymap.set('n', '<leader>ghS', function() gitsigns.stage_buffer() end, kopts)

        kopts.desc = 'Git: Unstage all hunks'
        vim.keymap.set('n', '<leader>ghU', function() gitsigns.reset_buffer_index() end, kopts)

        kopts.desc = 'Git: Reset hunk under cursor to staged'
        vim.keymap.set('n', '<leader>ghr', function() gitsigns.reset_hunk() end, kopts)

        kopts.desc = 'Git: Reset highlighted hunk to staged'
        vim.keymap.set('v', '<leader>ghr', function() gitsigns.reset_hunk { vim.fn.line '.', vim.fn.line 'v' } end, kopts)

        kopts.desc = 'Git: Reset all hunks to staged'
        vim.keymap.set('n', '<leader>ghR', function() gitsigns.reset_buffer() end, kopts)
      end,
    },
    config = function(_, opts)
      require('gitsigns').setup(opts)
      require('scrollbar.handlers.gitsigns').setup()
    end,
  },

  {
    'sindrets/diffview.nvim',
    name = 'diffview',
    cmd = { 'DiffviewOpen', 'DiffviewFileHistory' },
    keys = {
      { '<leader>gd', '<cmd>DiffviewOpen<CR>', desc = 'Git: Open Diffview' },
      { '<leader>gf', '<cmd>DiffviewFileHistory %<CR>', desc = 'Git: Open File History' },
      { '<leader>gl', '<cmd>DiffviewFileHistory<CR>', desc = 'Git: Show Logs' },
      { '<leader>gS', '<cmd>DiffviewFileHistory -g --range=stash<CR>', desc = 'Git: Stash' },
    },
    opts = {
      -- makes add/delete lines highlight more subtly
      enhanced_diff_hl = true,

      view = {
        -- left / right and bottom layout
        merge_tool = { layout = 'diff3_mixed' },
      },

      file_panel = {
        -- like with VSCode's
        listing_style = 'list',

        -- Has to match nvim-tree window width
        win_config = { width = 25 },
      },
    },
    config = function(_, opts)
      local actions = require 'diffview.actions'

      opts.keymaps = { disable_defaults = true }

      opts.keymaps.help_panel = {
        { 'n', 'q', actions.close, { desc = 'Help: Close' } },
      }

      opts.keymaps.option_panel = {
        { 'n', 'q', actions.close, { desc = 'Option: Close' } },
        { 'n', '?', actions.help 'option_panel', { desc = 'Option: Help' } },
        { 'n', '<Tab>', actions.select_entry, { desc = 'Option: Select' } },
      }

      -- opts.keymaps.commit_log_panel = {}

      opts.keymaps.file_panel = {
        { 'n', 'q', '<cmd>DiffviewClose<CR>', { desc = 'Diffview: Close' } },
        { 'n', '<C-r>', actions.refresh_files, { desc = 'Diffview: Refresh' } },

        { 'n', '?', actions.help 'file_panel', { desc = 'Panel: Help' } },
        { 'n', 'l', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
        { 'n', 'e', actions.goto_file_tab, { desc = 'Panel: Go to File' } },
        { 'n', 'L', actions.open_commit_log, { desc = 'Panel: Commit Log' } },

        { 'n', '[x', actions.prev_conflict, { desc = 'Merge: Previous Conflict' } },
        { 'n', ']x', actions.next_conflict, { desc = 'Merge: Next Conflict' } },
      }

      opts.keymaps.view = {
        { 'n', '<leader>q', '<cmd>DiffviewClose<CR>', { desc = 'Diffview: Close' } },

        { 'n', 'g?', actions.help 'view', { desc = 'View: Help' } },
        { 'n', '<leader>e', actions.focus_files, { desc = 'View: Focus Panel' } },
        { 'n', 'gf', actions.goto_file_tab, { desc = 'View: Go to File' } },
        { 'n', 'gl', actions.open_commit_log, { desc = 'View: Commit Log' } },

        { 'n', '[x', actions.prev_conflict, { desc = 'Merge: Previous Conflict' } },
        { 'n', ']x', actions.next_conflict, { desc = 'Merge: Next Conflict' } },
      }

      -- { 'n', 'y', actions.copy_hash, { desc = 'Panel: Copy Commit Hash' } },

      require('diffview').setup(opts)
    end,
  },
}
