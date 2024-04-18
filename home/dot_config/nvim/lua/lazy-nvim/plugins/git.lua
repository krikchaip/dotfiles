return {
  -- Adds git related signs to the gutter, as well as utilities for managing changes
  -- ref: https://github.com/lewis6991/gitsigns.nvim?tab=readme-ov-file
  {
    'lewis6991/gitsigns.nvim',
    name = 'gitsigns',
    version = '^0.8.0',
    dependencies = { 'nvim-treesitter.textobjects', 'scrollbar' },
    opts = {
      signs                             = {
        -- add          = { text = '+' },
        -- change       = { text = '~' },
        -- delete       = { text = '_' },
        -- topdelete    = { text = '‾' },
        -- changedelete = { text = '~' },
      },

      attach_to_untracked               = true,

      signcolumn                        = true,  -- Toggle with `:Gitsigns toggle_signs`
      numhl                             = true,  -- Toggle with `:Gitsigns toggle_numhl`
      linehl                            = false, -- Toggle with `:Gitsigns toggle_linehl`
      word_diff                         = false, -- Toggle with `:Gitsigns toggle_word_diff`
      current_line_blame                = true,  -- Toggle with `:Gitsigns toggle_current_line_blame`

      current_line_blame_opts           = {
        virt_text_pos = 'eol', -- 'eol' | 'overlay' | 'right_align'
        virt_text_priority = 1000,
        delay = 500,
        ignore_whitespace = true,
      },

      current_line_blame_formatter      = '     <author>, <author_time:%R> · <summary>',
      current_line_blame_formatter_opts = {
        relative_time = true,
      },

      on_attach                         = function(bufnr)
        local gitsigns = require 'gitsigns'
        local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        local function map(mode, l, r, opts)
          opts = opts or {}
          opts.buffer = bufnr

          vim.keymap.set(mode, l, r, opts)
        end

        -- [[ Navigation ]]

        local next_hunk_repeatable, prev_hunk_repeatable =
            ts_repeat_move.make_repeatable_move_pair(
              function()
                if vim.wo.diff then
                  vim.cmd.normal({ ']c', bang = true })
                else
                  gitsigns.nav_hunk('next', { preview = true })
                end
              end,
              function()
                if vim.wo.diff then
                  vim.cmd.normal({ '[c', bang = true })
                else
                  gitsigns.nav_hunk('prev', { preview = true })
                end
              end
            )

        map('n', ']c', next_hunk_repeatable, { desc = 'Jump to next unstaged [c]hange' })
        map('n', '[c', prev_hunk_repeatable, { desc = 'Jump to previous unstaged [c]hange' })

        -- [[ Menus ]]

        map('n', '<leader>gd', function()
          gitsigns.diffthis()
        end, { desc = 'Show [d]iff against staged changes' })

        map('n', '<leader>gD', function()
          gitsigns.diffthis('~')
        end, { desc = 'Show [D]iff against last commit' })

        map('n', '<leader>gi', function()
          gitsigns.blame_line { full = true }
        end, { desc = 'Show line [i]nfo' })

        -- [[ Actions ]]

        map('n', '<leader>gcs', function()
          gitsigns.stage_hunk()
        end, { desc = '[s]tage change at the cursor position' })

        map('v', '<leader>gcs', function()
          gitsigns.stage_hunk { vim.fn.line('.'), vim.fn.line('v') }
        end, { desc = '[s]tage selected range' })

        map('n', '<leader>gcS', function()
          gitsigns.stage_buffer()
        end, { desc = '[S]tage all changes' })

        map('n', '<leader>gcu', function()
          gitsigns.undo_stage_hunk()
        end, { desc = '[u]ndo the last staged change' })

        map('n', '<leader>gcU', function()
          gitsigns.reset_buffer_index()
        end, { desc = '[U]ndo all staged changes' })

        map('n', '<leader>gcr', function()
          gitsigns.reset_hunk()
        end, { desc = '[r]eset change at the cursor position to staged' })

        map('v', '<leader>gcr', function()
          gitsigns.reset_hunk { vim.fn.line('.'), vim.fn.line('v') }
        end, { desc = '[r]eset selected range to staged' })

        map('n', '<leader>gcR', function()
          gitsigns.reset_buffer()
        end, { desc = '[R]eset all changes to staged' })

        -- [[ Text objects ]]

        -- 'o' stands for 'Operator-pending' mode
        -- 'x' stands for 'Visual-only' mode
        map({ 'o', 'x' }, 'ic', '<cmd>Gitsigns select_hunk<CR>', { desc = 'the change under cursor' })
        map({ 'o', 'x' }, 'ac', '<cmd>Gitsigns select_hunk<CR>', { desc = 'the change under cursor' })
      end
    },
    config = function(_, opts)
      require('gitsigns').setup(opts)
      require('scrollbar.handlers.gitsigns').setup()
    end
  },
}
