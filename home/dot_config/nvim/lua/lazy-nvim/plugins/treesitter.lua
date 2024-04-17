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
    },
    config = function(_, opts)
      require('nvim-treesitter.configs').setup(opts)

      -- enable tree-sitter based folding
      -- NOTE: This will respect your `foldminlines` and `foldnestmax` settings
      vim.cmd('set foldmethod=expr')
      vim.cmd('set foldexpr=nvim_treesitter#foldexpr()')
      vim.cmd('set foldlevel=999') -- ref: https://stackoverflow.com/questions/5784677/the-first-time-i-close-a-fold-it-closes-all-folds
      -- vim.cmd('set nofoldenable')
    end
  },
}
