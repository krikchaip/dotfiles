return {
  -- Here is a more advanced example where we pass configuration
  -- options to `gitsigns.nvim`. This is equivalent to the following Lua:
  --    require('gitsigns').setup({ ... })
  --
  -- See `:help gitsigns` to understand what the configuration keys do
  { -- Adds git related signs to the gutter, as well as utilities for managing changes
    'lewis6991/gitsigns.nvim',
    opts = {
      signs                             = {
        add          = { text = '+' },
        change       = { text = '~' },
        delete       = { text = '_' },
        topdelete    = { text = '‾' },
        changedelete = { text = '~' },
      },

      attach_to_untracked               = true,

      signcolumn                        = true,  -- Toggle with `:Gitsigns toggle_signs`
      numhl                             = false, -- Toggle with `:Gitsigns toggle_numhl`
      linehl                            = false, -- Toggle with `:Gitsigns toggle_linehl`
      word_diff                         = false, -- Toggle with `:Gitsigns toggle_word_diff`
      current_line_blame                = true,  -- Toggle with `:Gitsigns toggle_current_line_blame`

      current_line_blame_opts           = {
        virt_text_pos = 'eol', -- 'eol' | 'overlay' | 'right_align'
        delay = 500,
        ignore_whitespace = true,
      },

      current_line_blame_formatter      = '     <author>, <author_time:%R> · <summary>',
      current_line_blame_formatter_opts = {
        relative_time = true,
      },

      on_attach                         = function(bufnr)
        local gitsigns = require('gitsigns')

        local function map(mode, l, r, opts)
          opts = opts or {}
          opts.buffer = bufnr

          vim.keymap.set(mode, l, r, opts)
        end

        -- [[ Navigation ]]

        map('n', ']c', function()
          if vim.wo.diff then
            vim.cmd.normal({ ']c', bang = true })
          else
            gitsigns.nav_hunk('next', { preview = true })
          end
        end, { desc = 'Jump to next unstaged [c]hange' })

        map('n', '[c', function()
          if vim.wo.diff then
            vim.cmd.normal({ '[c', bang = true })
          else
            gitsigns.nav_hunk('prev', { preview = true })
          end
        end, { desc = 'Jump to previous unstaged [c]hange' })

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

        -- 'o' stands for "Operator-pending" mode
        -- 'x' stands for "Visual-only" mode
        map({ 'o', 'x' }, 'ic', '<cmd>Gitsigns select_hunk<CR>', { desc = 'the change under cursor' })
        map({ 'o', 'x' }, 'ac', '<cmd>Gitsigns select_hunk<CR>', { desc = 'the change under cursor' })
      end
    },
  },
}
