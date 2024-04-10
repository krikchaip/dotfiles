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

        -- [WIP] Navigation

        -- map('n', ']c', function()
        --   if vim.wo.diff then
        --     vim.cmd.normal({ ']c', bang = true })
        --   else
        --     gitsigns.nav_hunk('next')
        --   end
        -- end)

        -- map('n', '[c', function()
        --   if vim.wo.diff then
        --     vim.cmd.normal({ '[c', bang = true })
        --   else
        --     gitsigns.nav_hunk('prev')
        --   end
        -- end)

        -- [WIP] Actions

        -- map('n', '<leader>hs', gitsigns.stage_hunk)
        -- map('v', '<leader>hs', function() gitsigns.stage_hunk { vim.fn.line('.'), vim.fn.line('v') } end)

        -- map('n', '<leader>hr', gitsigns.reset_hunk)
        -- map('v', '<leader>hr', function() gitsigns.reset_hunk { vim.fn.line('.'), vim.fn.line('v') } end)

        -- map('n', '<leader>hu', gitsigns.undo_stage_hunk)

        -- map('n', '<leader>hS', gitsigns.stage_buffer)
        -- map('n', '<leader>hR', gitsigns.reset_buffer)

        -- map('n', '<leader>hp', gitsigns.preview_hunk)
        -- map('n', '<leader>hb', function() gitsigns.blame_line { full = true } end)
        -- map('n', '<leader>hd', gitsigns.diffthis)
        -- map('n', '<leader>hD', function() gitsigns.diffthis('~') end)

        -- map('n', '<leader>tb', gitsigns.toggle_current_line_blame)
        -- map('n', '<leader>td', gitsigns.toggle_deleted)

        -- [WIP] Text objects

        -- 'o' stands for "Operator-pending" mode
        -- 'x' stands for "Visual-only" mode
        -- map({ 'o', 'x' }, 'ih', ':<C-U>Gitsigns select_hunk<CR>')
      end
    },
  },
}
