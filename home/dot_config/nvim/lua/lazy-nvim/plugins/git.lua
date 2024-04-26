return {
  -- Adds git related signs to the gutter, as well as utilities for managing changes
  -- ref: https://github.com/lewis6991/gitsigns.nvim?tab=readme-ov-file
  {
    'lewis6991/gitsigns.nvim',
    name = 'gitsigns',
    version = '^0.8.0',
    cond = function()
      return is_git_repo() or is_git_file()
    end,
    event = { 'BufReadPre', 'BufNewFile' },
    opts = {
      signs                             = {
        -- add          = { text = '┃' },
        -- change       = { text = '┃' },
        delete       = { text = '⏵' },
        topdelete    = { text = '⏵' },
        -- changedelete = { text = '~' },
        -- untracked    = { text = '┆' },
      },

      attach_to_untracked               = true,

      signcolumn                        = true,  -- Toggle with `:Gitsigns toggle_signs`
      numhl                             = true,  -- Toggle with `:Gitsigns toggle_numhl`
      linehl                            = false, -- Toggle with `:Gitsigns toggle_linehl`
      word_diff                         = false, -- Toggle with `:Gitsigns toggle_word_diff`
      current_line_blame                = true,  -- Toggle with `:Gitsigns toggle_current_line_blame`

      current_line_blame_opts           = {
        virt_text_pos      = 'eol', -- 'eol' | 'overlay' | 'right_align'
        virt_text_priority = 1000,
        delay              = 500,
        ignore_whitespace  = true,
      },

      current_line_blame_formatter      = '     <author>, <author_time:%R> · <summary>',
      current_line_blame_formatter_opts = {
        relative_time = true,
      },

      on_attach                         = function(bufnr)
        local gitsigns = require 'gitsigns'
        local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        -- set buffer to `0` or `true` for current buffer
        local kopts = { buffer = bufnr, silent = true }

        -- [[ Navigation ]]

        local next_hunk, prev_hunk = ts_repeat_move.make_repeatable_move_pair(
          function()
            if vim.wo.diff then
              vim.cmd.normal({ ']c', bang = true })
            else
              gitsigns.nav_hunk('next', { preview = false })
            end
          end,
          function()
            if vim.wo.diff then
              vim.cmd.normal({ '[c', bang = true })
            else
              gitsigns.nav_hunk('prev', { preview = false })
            end
          end
        )

        kopts.desc = 'Next unstaged [c]hange'
        vim.keymap.set('n', ']c', next_hunk, kopts)

        kopts.desc = 'Previous unstaged [c]hange'
        vim.keymap.set('n', '[c', prev_hunk, kopts)

        -- [[ Menus ]]

        kopts.desc = 'Show [d]iff against staged changes'
        vim.keymap.set('n', '<leader>gd', function() gitsigns.diffthis() end, kopts)

        kopts.desc = 'Show [D]iff against last commit'
        vim.keymap.set('n', '<leader>gD', function() gitsigns.diffthis('~') end, kopts)

        kopts.desc = 'Show line [i]nfo'
        vim.keymap.set('n', '<leader>gi', function() gitsigns.blame_line { full = true } end, kopts)

        -- [[ Actions ]]

        kopts.desc = '[s]tage change at the cursor position'
        vim.keymap.set('n', '<leader>gcs', function() gitsigns.stage_hunk() end, kopts)

        kopts.desc = '[s]tage selected range'
        vim.keymap.set('v', '<leader>gcs', function()
          gitsigns.stage_hunk { vim.fn.line('.'), vim.fn.line('v') }
        end, kopts)

        kopts.desc = '[S]tage all changes'
        vim.keymap.set('n', '<leader>gcS', function() gitsigns.stage_buffer() end, kopts)

        kopts.desc = '[u]ndo the last staged change'
        vim.keymap.set('n', '<leader>gcu', function() gitsigns.undo_stage_hunk() end, kopts)

        kopts.desc = '[U]ndo all staged changes'
        vim.keymap.set('n', '<leader>gcU', function() gitsigns.reset_buffer_index() end, kopts)

        kopts.desc = '[r]eset change at the cursor position to staged'
        vim.keymap.set('n', '<leader>gcr', function() gitsigns.reset_hunk() end, kopts)

        kopts.desc = '[r]eset selected range to staged'
        vim.keymap.set('v', '<leader>gcr', function()
          gitsigns.reset_hunk { vim.fn.line('.'), vim.fn.line('v') }
        end, kopts)

        kopts.desc = '[R]eset all changes to staged'
        vim.keymap.set('n', '<leader>gcR', function() gitsigns.reset_buffer() end, kopts)

        -- [[ Text objects ]]
        -- 'o' stands for 'Operator-pending' mode
        -- 'x' stands for 'Visual-only' mode

        kopts.desc = 'the change under cursor'
        vim.keymap.set({ 'o', 'x' }, 'ic', '<cmd>Gitsigns select_hunk<CR>', kopts)

        kopts.desc = 'the change under cursor'
        vim.keymap.set({ 'o', 'x' }, 'ac', '<cmd>Gitsigns select_hunk<CR>', kopts)
      end
    },
    config = function(_, opts)
      require('gitsigns').setup(opts)
      require('scrollbar.handlers.gitsigns').setup()
    end
  },
}
