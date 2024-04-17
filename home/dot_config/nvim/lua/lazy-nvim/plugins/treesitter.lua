return {
  { -- Highlight, edit, and navigate code
    'nvim-treesitter/nvim-treesitter',
    build = ':TSUpdate',
    dependencies = {
      -- Nushell syntax highlight support
      -- ref: https://github.com/nushell/tree-sitter-nu
      { 'nushell/tree-sitter-nu' },

      -- extended text objects (di*, da*, ci*, ca*, etc.)
      -- ref: https://github.com/nvim-treesitter/nvim-treesitter-textobjects
      { 'nvim-treesitter/nvim-treesitter-textobjects' },
    },
    opts = {
      auto_install = true, -- Autoinstall languages that are not installed

      ensure_installed = {
        'lua', 'luadoc',
        'vim', 'vimdoc',
        'html', 'css',
        'javascript', 'typescript', 'tsx',
        'json', 'jsonc',
        'markdown',
        'elixir',
      },

      highlight = {
        enable = true,

        -- Some languages depend on vim's regex highlighting system (such as Ruby) for indent rules.
        -- If you are experiencing weird indenting issues, add the language to
        -- the list of additional_vim_regex_highlighting and disabled languages for indent.
        additional_vim_regex_highlighting = {
          'ruby',
        },

        -- NOTE: these are the names of the parsers and not the filetype.
        disable = function(lang, _)
          local ignored_list = { 'json', 'jsonc', 'chezmoitmpl' }

          for _, ignored in ipairs(ignored_list) do
            if string.find(lang, ignored)
                or string.find(vim.bo.filetype, ignored) then
              return true
            end
          end
        end,
      },

      indent = {
        -- NOTE: This is an experimental feature.
        enable = true,

        -- NOTE: these are the names of the parsers and not the filetype.
        disable = {
          'ruby',
        }
      },

      -- like `Expand Selection` feature in VSCode
      incremental_selection = {
        enable = true,

        keymaps = {
          init_selection = '<C-S-=>',
          node_incremental = '<C-S-=>',
          node_decremental = '<C-S-->',
          scope_incremental = false,
        },
      },

      textobjects = {
        select = {
          enable = true,

          -- Automatically jump forward to textobj, similar to targets.vim
          lookahead = true,

          keymaps = {
            ['aa'] = { query = '@parameter.outer', desc = 'an [a]rgument' },
            ['ia'] = { query = '@parameter.inner', desc = 'inner [a]rgument' },

            ['am'] = { query = '@function.outer', desc = 'a [m]ethod' },
            ['af'] = { query = '@function.outer', desc = 'a [f]unction' },
            ['im'] = { query = '@function.inner', desc = 'inner [m]ethod' },
            ['if'] = { query = '@function.inner', desc = 'inner [f]unction' },

            ['al'] = { query = '@assignment.lhs', desc = 'a [l]eft assignment' },
            ['ar'] = { query = '@assignment.rhs', desc = 'a [r]ight assignment' },
            ['il'] = { query = '@assignment.lhs', desc = 'inner [l]eft assignment' },
            ['ir'] = { query = '@assignment.rhs', desc = 'inner [r]ight assignment' },

            ['a.'] = { query = '@assignment.outer', desc = 'an assignment' },
            ['i.'] = { query = '@assignment.inner', desc = 'inner assignment' },
          },
        },

        swap = {
          enable = true,

          swap_next = {
            ['<leader>sa'] = { query = '@parameter.inner', desc = 'With next [a]rgument' },
          },

          swap_previous = {
            ['<leader>sA'] = { query = '@parameter.inner', desc = 'With previous [a]rgument' },
          },
        },

        move = {
          enable = true,

          -- whether to set jumps in the jumplist
          set_jumps = true,

          goto_next_start = {
            [']a'] = { query = '@parameter.inner', desc = 'Next [a]rgument start' },

            [']m'] = { query = '@function.outer', desc = 'Next [m]ethod start' },
            [']f'] = { query = '@function.outer', desc = 'Next [f]unction start' },

            [']l'] = { query = '@assignment.lhs', desc = 'Next [l]eft assignment start' },
            [']r'] = { query = '@assignment.rhs', desc = 'Next [r]ight assignment start' },

            ['].'] = { query = '@assignment.outer', desc = 'Next assignment start' },
          },

          goto_next_end = {
            [']A'] = { query = '@parameter.inner', desc = 'Next [a]rgument end' },

            [']M'] = { query = '@function.outer', desc = 'Next [m]ethod end' },
            [']F'] = { query = '@function.outer', desc = 'Next [f]unction end' },

            [']L'] = { query = '@assignment.lhs', desc = 'Next [l]eft assignment end' },
            [']R'] = { query = '@assignment.rhs', desc = 'Next [r]ight assignment end' },

            [']>'] = { query = '@assignment.outer', desc = 'Next assignment end' },
          },

          goto_previous_start = {
            ['[a'] = { query = '@parameter.inner', desc = 'Previous [a]rgument start' },

            ['[m'] = { query = '@function.outer', desc = 'Previous [m]ethod start' },
            ['[f'] = { query = '@function.outer', desc = 'Previous [f]unction start' },

            ['[l'] = { query = '@assignment.lhs', desc = 'Previous [l]eft assignment start' },
            ['[r'] = { query = '@assignment.rhs', desc = 'Previous [r]ight assignment start' },

            ['[.'] = { query = '@assignment.outer', desc = 'Previous assignment start' },
          },

          goto_previous_end = {
            ['[A'] = { query = '@parameter.inner', desc = 'Previous [a]rgument end' },

            ['[M'] = { query = '@function.outer', desc = 'Previous [m]ethod end' },
            ['[F'] = { query = '@function.outer', desc = 'Previous [f]unction end' },

            ['[L'] = { query = '@assignment.lhs', desc = 'Previous [l]eft assignment end' },
            ['[R'] = { query = '@assignment.rhs', desc = 'Previous [r]ight assignment end' },

            ['[>'] = { query = '@assignment.outer', desc = 'Previous assignment end' },
          },
        }
      },
    },
    config = function(_, opts)
      local ts_configs = require 'nvim-treesitter.configs'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      ts_configs.setup(opts)

      -- Repeat movement with ; and ,
      -- ensure ; goes forward and , goes backward regardless of the last direction
      vim.keymap.set({ 'n', 'x', 'o' }, ';', function()
        ts_repeat_move.repeat_last_move_next()
      end, { desc = 'Repeat last move next' })
      vim.keymap.set({ 'n', 'x', 'o' }, ',', function()
        ts_repeat_move.repeat_last_move_previous()
      end, { desc = 'Repeat last move previous' })

      -- Optionally, make builtin f, F, t, T also repeatable with ; and ,
      vim.keymap.set({ 'n', 'x', 'o' }, 'f', ts_repeat_move.builtin_f)
      vim.keymap.set({ 'n', 'x', 'o' }, 'F', ts_repeat_move.builtin_F)
      vim.keymap.set({ 'n', 'x', 'o' }, 't', ts_repeat_move.builtin_t)
      vim.keymap.set({ 'n', 'x', 'o' }, 'T', ts_repeat_move.builtin_T)

      -- enable tree-sitter based folding
      -- NOTE: This will respect your `foldminlines` and `foldnestmax` settings
      vim.cmd('set foldmethod=expr')
      vim.cmd('set foldexpr=nvim_treesitter#foldexpr()')
      vim.cmd('set foldlevel=999') -- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
      -- vim.cmd('set nofoldenable')
    end
  },
}
