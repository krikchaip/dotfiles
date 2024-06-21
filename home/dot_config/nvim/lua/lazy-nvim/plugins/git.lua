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

        kopts.desc = 'Git: Unstaged Hunk'
        vim.keymap.set('n', ']c', next_hunk, kopts)

        kopts.desc = 'Git: Unstaged Hunk'
        vim.keymap.set('n', '[c', prev_hunk, kopts)

        -- [[ Menus ]]

        kopts.desc = 'Git: Show Line Info'
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

        -- [[ Text Objects ]]

        kopts.desc = 'Git: Hunk under cursor'
        vim.keymap.set({ 'o', 'x' }, 'ic', function() gitsigns.select_hunk() end, kopts)

        kopts.desc = 'Git: Hunk under cursor'
        vim.keymap.set({ 'o', 'x' }, 'ac', function() gitsigns.select_hunk() end, kopts)
      end,
    },
    config = function(_, opts)
      require('gitsigns').setup(opts)
      require('scrollbar.handlers.gitsigns').setup()
    end,
  },

  -- TODO: git log sub commands (`glx`, `gly`). eg. one git log command for neogit, another for diffview
  -- TODO: merge conflict keymappings
  {
    'sindrets/diffview.nvim',
    name = 'diffview',
    cmd = { 'DiffviewOpen', 'DiffviewFileHistory' },
    keys = {
      { '<leader>gd', '<cmd>DiffviewOpen<CR>', desc = 'Git: Open Diffview' },
      { '<leader>gf', '<cmd>DiffviewFileHistory %<CR>', desc = 'Git: Open File History' },
      { '<leader>gf', ':DiffviewFileHistory<CR>', desc = 'Git: Open Line History', mode = 'x' },
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
        win_config = { width = 30 },
      },
    },
    config = function(_, opts)
      local actions = require 'diffview.actions'

      opts.keymaps = { disable_defaults = true }

      opts.keymaps.view = {
        { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },

        { 'n', 'g?', actions.help 'view', { desc = 'View: Help' } },
        { 'n', '<leader>e', actions.focus_files, { desc = 'View: Focus Panel' } },
        { 'n', 'gf', actions.goto_file_tab, { desc = 'View: Go to File' } },
        { 'n', 'gl', actions.open_commit_log, { desc = 'View: Commit Log' } },

        { 'n', '<Tab>', actions.select_next_entry, { desc = 'Entry: Select Next' } },
        { 'n', '<S-Tab>', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
      }

      opts.keymaps.diff_view = {
        { 'n', '[x', actions.prev_conflict, { desc = 'Merge: Previous Conflict' } },
        { 'n', ']x', actions.next_conflict, { desc = 'Merge: Next Conflict' } },
      }

      opts.keymaps.file_panel = {
        { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },
        { 'n', '<C-r>', actions.refresh_files, { desc = 'Diffview: Refresh' } },

        { 'n', '?', actions.help 'file_panel', { desc = 'Panel: Help' } },
        { 'n', 'l', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
        { 'n', 'e', actions.goto_file_tab, { desc = 'Panel: Go to File' } },
        { 'n', 'L', actions.open_commit_log, { desc = 'Panel: Commit Log' } },
        { 'n', 'c', '<cmd>Neogit commit<CR>', { desc = 'Panel: Commit Popup' } },
        { 'n', 'n', '<cmd>Neogit<CR>', { desc = 'Panel: Neogit Popup' } },

        { 'n', 'j', actions.select_next_entry, { desc = 'Entry: Select Next' } },
        { 'n', 'k', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
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

      opts.keymaps.file_history_panel = {
        { 'n', 'q', smart_close_tabpage, { desc = 'Diffview: Close' } },
        { 'n', '<C-r>', actions.refresh_files, { desc = 'Diffview: Refresh' } },
        { 'n', '!', actions.options, { desc = 'Diffview: Open Option Panel' } },

        { 'n', '?', actions.help 'file_history_panel', { desc = 'Panel: Help' } },
        { 'n', 'l', actions.focus_entry, { desc = 'Panel: Focus Right Diff' } },
        { 'n', 'e', actions.goto_file_tab, { desc = 'Panel: Go to File' } },
        { 'n', 'L', actions.open_commit_log, { desc = 'Panel: Commit Log' } },
        { 'n', 'y', actions.copy_hash, { desc = 'Panel: Copy Commit Hash' } },

        { 'n', 'j', actions.select_next_entry, { desc = 'Entry: Select Next' } },
        { 'n', 'k', actions.select_prev_entry, { desc = 'Entry: Select Previous' } },
        { 'n', '<CR>', actions.select_entry, { desc = 'Entry: Select Current' } },
        { 'n', 'X', actions.restore_entry, { desc = 'Entry: Revert Changes' } },
        { 'n', 'J', actions.select_next_commit, { desc = 'Entry: Select Next Commit' } },
        { 'n', 'K', actions.select_prev_commit, { desc = 'Entry: Select Previous Commit' } },

        { 'n', '<M-d>', actions.scroll_view(0.25), { desc = 'View: Scroll Down Half Page' } },
        { 'n', '<M-u>', actions.scroll_view(-0.25), { desc = 'View: Scroll Up Half Page' } },
        { 'n', '<M-j>', actions.scroll_view(1), { desc = 'View: Scroll Down' } },
        { 'n', '<M-k>', actions.scroll_view(-1), { desc = 'View: Scroll Up' } },
      }

      opts.keymaps.option_panel = {
        { 'n', 'q', actions.close, { desc = 'Option: Close' } },
        { 'n', '?', actions.help 'option_panel', { desc = 'Option: Help' } },
        { 'n', '<Tab>', actions.select_entry, { desc = 'Option: Select' } },
      }

      opts.keymaps.help_panel = {
        { 'n', 'q', actions.close, { desc = 'Help: Close' } },
      }

      require('diffview').setup(opts)
    end,
  },

  {
    'NeogitOrg/neogit',
    name = 'neogit',
    cmd = { 'Neogit' },
    keys = {
      { '<leader>gs', '<cmd>Neogit<CR>', desc = 'Git: Show Status' },
      { '<leader>gc', '<cmd>Neogit commit<CR>', desc = 'Git: Open Commit Popup' },
    },
    dependencies = { 'plenary', 'diffview', 'telescope' },
    opts = {
      telescope_sorter = function()
        -- use the native fzf sorter from telescope extension
        return require('telescope').extensions.fzf.native_fzf_sorter()
      end,

      integrations = {
        -- If enabled, use telescope for menu selection rather than vim.ui.select.
        -- Allows multi-select and some things that vim.ui.select doesn't.
        telescope = true,

        -- Neogit only provides inline diffs. If you want a more traditional way to look at diffs, you can use `diffview`.
        -- The diffview integration enables the diff popup.
        diffview = true,
      },

      -- "ascii"   is the graph the git CLI generates
      -- "unicode" is the graph like https://github.com/rbong/vim-flog
      graph_style = 'unicode',

      -- Changes what mode the Commit Editor starts in.
      -- `true` will leave nvim in normal mode,
      -- `false` will change nvim to insert mode, and
      -- `"auto"` will change nvim to insert mode IF the commit message is empty, otherwise leaving it in normal mode.
      disable_insert_on_commit = true,

      -- Change the default way of opening Neogit status window
      -- values: 'tab' (default), 'split', 'vsplit', 'floating'
      kind = 'floating',

      popup = { kind = 'floating' },

      commit_editor = { kind = 'floating', show_staged_diff = false },

      commit_select_view = { kind = 'floating' },

      log_view = { kind = 'floating' },

      commit_view = { kind = 'floating' },

      reflog_view = { kind = 'floating' },

      preview_buffer = { kind = 'floating' },

      -- Configure each section in the Neogit status popup
      sections = {
        stashes = { folded = false },

        unpulled_upstream = { folded = false },

        unpulled_pushRemote = { folded = false },

        recent = { folded = false },

        rebase = { folded = false },
      },

      -- Set to false if you want to be responsible for creating _ALL_ keymappings
      use_default_keymaps = true,
    },
  },
}
