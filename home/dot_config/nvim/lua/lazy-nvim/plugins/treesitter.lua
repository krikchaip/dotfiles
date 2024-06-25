return {
  -- Nushell syntax highlight support
  -- ref: https://github.com/nushell/tree-sitter-nu
  {
    'nushell/tree-sitter-nu',
    name = 'nvim-treesitter.nushell',
    ft = 'nu',
  },

  -- extended text objects (di*, da*, ci*, ca*, etc.)
  -- ref: https://github.com/nvim-treesitter/nvim-treesitter-textobjects
  {
    'nvim-treesitter/nvim-treesitter-textobjects',
    name = 'nvim-treesitter.textobjects',
  },

  -- autoclose and autorename html-like tag
  -- ref: https://github.com/windwp/nvim-ts-autotag
  {
    'windwp/nvim-ts-autotag',
    name = 'nvim-treesitter.autotag',
    event = { 'BufReadPost', 'BufNewFile' },
    opts = {
      opts = {
        enable_close_on_slash = true, -- Auto close on trailing </
      },
    },
  },

  -- Highlight, edit, and code navigation
  -- ref: https://github.com/nvim-treesitter/nvim-treesitter
  {
    'nvim-treesitter/nvim-treesitter',
    name = 'nvim-treesitter',
    build = ':TSUpdate',
    event = { 'BufReadPre', 'BufNewFile' },
    opts = {
      auto_install = true, -- Autoinstall languages that are not installed

      ensure_installed = {
        'git_config',
        'git_rebase',
        'gitattributes',
        'gitcommit',
        'gitignore',

        'bash',

        'lua',
        'luadoc',

        'vim',
        'vimdoc',

        'regex',

        'html',
        'css',
        'javascript',
        'typescript',
        'tsx',
        'json',
        'jsonc',

        'markdown',
        'markdown_inline',

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
            if string.find(lang, ignored) or string.find(vim.bo.filetype, ignored) then return true end
          end
        end,
      },

      indent = {
        -- NOTE: This is an experimental feature.
        enable = true,

        -- NOTE: these are the names of the parsers and not the filetype.
        disable = {
          'ruby',
        },
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
          -- lookahead = true,

          keymaps = {
            ['aa'] = { query = '@parameter.outer', desc = 'Treesitter: Argument' },
            ['am'] = { query = '@function.outer', desc = 'Treesitter: Method' },
            ['af'] = { query = '@function.outer', desc = 'Treesitter: Function' },
            ['al'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment' },
            ['ar'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment' },
            ['a='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment' },
            ['ax'] = { query = '@call.outer', desc = 'Treesitter: Function Call' },
            ['ai'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement' },
            ['ao'] = { query = '@loop.outer', desc = 'Treesitter: Loop' },
            ['ae'] = { query = '@return.outer', desc = 'Treesitter: Return Statement' },

            ['ia'] = { query = '@parameter.inner', desc = 'Treesitter: Argument' },
            ['im'] = { query = '@function.inner', desc = 'Treesitter: Method' },
            ['if'] = { query = '@function.inner', desc = 'Treesitter: Function' },
            ['il'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment' },
            ['ir'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment' },
            ['i='] = { query = '@assignment.inner', desc = 'Treesitter: Assignment' },
            ['ix'] = { query = '@call.inner', desc = 'Treesitter: Function Call' },
            ['ii'] = { query = '@conditional.inner', desc = 'Treesitter: If Statement' },
            ['io'] = { query = '@loop.inner', desc = 'Treesitter: Loop' },
            ['ie'] = { query = '@return.inner', desc = 'Treesitter: Return Statement' },
          },
        },

        swap = {
          enable = true,

          swap_next = {
            ['ga'] = { query = '@parameter.inner', desc = 'Swap: Next Argument' },
          },

          swap_previous = {
            ['gA'] = { query = '@parameter.inner', desc = 'Swap: Previous Argument' },
          },
        },

        move = {
          enable = true,

          -- whether to set jumps in the jumplist
          set_jumps = true,

          goto_next_start = {
            [']a'] = { query = '@parameter.inner', desc = 'Treesitter: Argument Start' },
            [']m'] = { query = '@function.outer', desc = 'Treesitter: Method Start' },
            [']f'] = { query = '@function.outer', desc = 'Treesitter: Function Start' },
            [']l'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment Start' },
            [']r'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment Start' },
            [']='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment Start' },
            [']x'] = { query = '@call.outer', desc = 'Treesitter: Function Call Start' },
            [']i'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement Start' },
            [']o'] = { query = '@loop.outer', desc = 'Treesitter: Loop Start' },
            [']e'] = { query = '@return.outer', desc = 'Treesitter: Return Statement Start' },
          },

          goto_next_end = {
            [']A'] = { query = '@parameter.inner', desc = 'Treesitter: Argument End' },
            [']M'] = { query = '@function.outer', desc = 'Treesitter: Method End' },
            [']F'] = { query = '@function.outer', desc = 'Treesitter: Function End' },
            [']L'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment End' },
            [']R'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment End' },
            [']+'] = { query = '@assignment.outer', desc = 'Treesitter: Assignment End' },
            [']X'] = { query = '@call.outer', desc = 'Treesitter: Function Call End' },
            [']I'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement End' },
            [']O'] = { query = '@loop.outer', desc = 'Treesitter: Loop End' },
            [']E'] = { query = '@return.outer', desc = 'Treesitter: Return Statement End' },
          },

          goto_previous_start = {
            ['[a'] = { query = '@parameter.inner', desc = 'Treesitter: Argument Start' },
            ['[m'] = { query = '@function.outer', desc = 'Treesitter: Method Start' },
            ['[f'] = { query = '@function.outer', desc = 'Treesitter: Function Start' },
            ['[l'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment Start' },
            ['[r'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment Start' },
            ['[='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment Start' },
            ['[x'] = { query = '@call.outer', desc = 'Treesitter: Function Call Start' },
            ['[i'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement Start' },
            ['[o'] = { query = '@loop.outer', desc = 'Treesitter: Loop Start' },
            ['[e'] = { query = '@return.outer', desc = 'Treesitter: Return Statement Start' },
          },

          goto_previous_end = {
            ['[A'] = { query = '@parameter.inner', desc = 'Treesitter: Argument End' },
            ['[M'] = { query = '@function.outer', desc = 'Treesitter: Method End' },
            ['[F'] = { query = '@function.outer', desc = 'Treesitter: Function End' },
            ['[L'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment End' },
            ['[R'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment End' },
            ['[+'] = { query = '@assignment.outer', desc = 'Treesitter: Assignment End' },
            ['[X'] = { query = '@call.outer', desc = 'Treesitter: Function Call End' },
            ['[I'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement End' },
            ['[O'] = { query = '@loop.outer', desc = 'Treesitter: Loop End' },
            ['[E'] = { query = '@return.outer', desc = 'Treesitter: Return Statement End' },
          },
        },
      },
    },
    config = function(_, opts)
      local ts_configs = require 'nvim-treesitter.configs'
      local ts_action = require 'nvim-treesitter.textobjects.repeatable_move'

      ts_configs.setup(opts)

      -- Repeat movement with ; and ,
      -- ensure ; goes forward and , goes backward regardless of the last direction
      vim.keymap.set({ 'n', 'x', 'o' }, ';', ts_action.repeat_last_move_next, { desc = 'Repeat last move next' })
      vim.keymap.set({ 'n', 'x', 'o' }, ',', ts_action.repeat_last_move_previous, { desc = 'Repeat last move previous' })

      -- vim way: ; goes to the direction you were moving.
      -- vim.keymap.set({ 'n', 'x', 'o' }, ';', ts_action.repeat_last_move, { desc = 'Repeat last move' })
      -- vim.keymap.set({ 'n', 'x', 'o' }, ',', ts_action.repeat_last_move_opposite, { desc = 'Repeat last move opposite' })

      -- Optionally, make builtin f, F, t, T also repeatable with ; and ,
      vim.keymap.set({ 'n', 'x', 'o' }, 'f', ts_action.builtin_f_expr, { expr = true })
      vim.keymap.set({ 'n', 'x', 'o' }, 'F', ts_action.builtin_F_expr, { expr = true })
      vim.keymap.set({ 'n', 'x', 'o' }, 't', ts_action.builtin_t_expr, { expr = true })
      vim.keymap.set({ 'n', 'x', 'o' }, 'T', ts_action.builtin_T_expr, { expr = true })

      -- enable tree-sitter based folding
      -- NOTE: This will respect your `foldminlines` and `foldnestmax` settings
      -- vim.cmd('set foldmethod=expr')
      -- vim.cmd('set foldexpr=nvim_treesitter#foldexpr()')
    end,
  },
}
