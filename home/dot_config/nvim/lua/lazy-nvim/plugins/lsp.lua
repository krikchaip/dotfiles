return {
  -- a package manager for LSP servers, DAP servers linters and formatters
  -- ref: https://github.com/williamboman/mason.nvim
  -- NOTE: is optimized to load as little as possible during setup.
  --       Lazy-loading the plugin, or somehow deferring the setup,
  --       is not recommended.
  {
    'williamboman/mason.nvim',
    name = 'mason',
    lazy = false,
    opts = {
      ui = {
        icons = {
          package_installed = '✓',
          package_pending = '➜',
          package_uninstalled = '✗'
        },

        -- see https://github.com/williamboman/mason.nvim?tab=readme-ov-file#default-configuration
        keymaps = {},
      },
    },
    config = function(_, opts)
      require('mason').setup(opts)

      vim.keymap.set('n', '<C-S-l>', '<cmd>Mason<CR>', { desc = 'Open Mason popup window' })
    end
  },

  -- closes gaps that exist between mason.nvim and nvim-lspconfig
  -- ref: https://github.com/williamboman/mason-lspconfig.nvim
  {
    'williamboman/mason-lspconfig.nvim',
    name = 'mason-lspconfig',
    dependencies = { 'mason' },
    opts = {
      automatic_installation = true,

      ensure_installed = {
        'lua_ls',
        'html', 'cssls', 'tailwindcss',
        'tsserver',
        'jsonls',
        'marksman',
        'elixirls',
      },
    },
  },

  -- help managing Mason package installation and updates
  -- ref: https://github.com/WhoIsSethDaniel/mason-tool-installer.nvim
  -- {
  --   'WhoIsSethDaniel/mason-tool-installer.nvim',
  --   name = 'mason-tool-installer',
  --   dependencies = { 'mason-lspconfig' },
  --   opts = {},
  -- },

  -- configures lua_ls for completion, annotations and signatures of Neovim apis
  -- ref: https://github.com/folke/neodev.nvim
  {
    'folke/neodev.nvim',
    name = 'neodev',
    opts = {},
  },

  -- actual configs and apis for the Nvim LSP client
  -- ref: https://github.com/neovim/nvim-lspconfig
  {
    'neovim/nvim-lspconfig',
    name = 'lspconfig',
    dependencies = {
      'mason',
      'mason-lspconfig',
      'neodev',
      'nvim-treesitter.textobjects',
      'telescope',
    },
    config = function()
      local lspconfig = require 'lspconfig'
      local mason_lspconfig = require 'mason-lspconfig'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'
      local builtin = require 'telescope.builtin'

      -- default Nvim LSP client capabilities
      local capabilities = vim.lsp.protocol.make_client_capabilities()

      -- TODO: LSP autocomplete integration
      -- capabilities = vim.tbl_deep_extend('force', capabilities, require('cmp_nvim_lsp').default_capabilities())

      -- [[ lspconfig-all, lspconfig-setup ]]
      mason_lspconfig.setup_handlers {
        -- will be called for each installed server that doesn't have a dedicated handler
        function(server_name)
          lspconfig[server_name].setup {
            -- tell LSP servers what capabilities that the client (nvim) can handle
            capabilities = capabilities,
          }
        end,

        -- ref: https://luals.github.io/wiki/settings
        ['lua_ls'] = function()
          lspconfig['lua_ls'].setup {
            capabilities = capabilities,
            settings = {
              Lua = {
                completion = {
                  callSnippet = 'Replace',
                },
                diagnostics = {
                  disable = { 'missing-fields' }
                },
              }
            },
          }
        end
      }

      -- Global keymappings that doesn't require a buffer
      vim.keymap.set('n', '<leader>li', '<cmd>LspInfo<CR>', { desc = 'Show LSP [i]nfo for current buffer' })
      vim.keymap.set('n', '<leader>lr', '<cmd>LspRestart<CR>', { desc = '[r]estart running LSP for current buffer' })

      -- Diagnostic keymaps
      local next_diagnostic, prev_diagnostic = ts_repeat_move.make_repeatable_move_pair(
        vim.diagnostic.goto_next,
        vim.diagnostic.goto_prev
      )

      vim.keymap.set('n', ']d', next_diagnostic, { desc = 'Go to next [d]iagnostic message' })
      vim.keymap.set('n', '[d', prev_diagnostic, { desc = 'Go to previous [d]iagnostic message' })

      -- will get run when an LSP attaches to a particular buffer
      vim.api.nvim_create_autocmd('LspAttach', {
        desc = 'Configure hover UIs and map keybindings when an LSP attached to a buffer',
        group = vim.api.nvim_create_augroup('lsp-attach-config', {}),
        callback = function(event)
          setup_diagnostic_hover(event)
          setup_highlight_references_hover(event)

          -- [[ Buffer local mappings ]]
          local opts = { buffer = event.buf, silent = true }

          -- Opens a popup that displays documentation about the word under your cursor
          -- See `:help K` for why this keymap.
          opts.desc = 'Hover Documentation'
          vim.keymap.set('n', 'K', vim.lsp.buf.hover, opts)

          -- Jump to the definition of the word under your cursor.
          -- This is where a variable was first declared, or where a function is defined, etc.
          -- To jump back, press <C-t>.
          opts.desc = 'Jump to [d]efinition'
          vim.keymap.set('n', 'gd', builtin.lsp_definitions, opts)

          -- Jump to the type of the word under your cursor.
          -- Useful when you're not sure what type a variable is and you want to see
          -- the definition of its *type*, not where it was *defined*.
          opts.desc = 'Jump to type [D]efinition'
          vim.keymap.set('n', 'gD', builtin.lsp_type_definitions, opts)

          -- Jump to the implementation of the word under your cursor.
          -- Useful when your language has ways of declaring types without an actual implementation.
          opts.desc = 'Jump to [I]mplementation'
          vim.keymap.set('n', 'gI', builtin.lsp_implementations, opts)

          -- Find all references for the word under your cursor.
          opts.desc = 'Show [r]eferences'
          vim.keymap.set('n', 'gr', builtin.lsp_references, opts)

          -- Fuzzy find all the symbols in your current document.
          -- Symbols are things like variables, functions, types, etc.
          opts.desc = 'Show document [s]ymbols'
          vim.keymap.set('n', '<leader>ls', builtin.lsp_document_symbols, opts)

          -- Fuzzy find all the symbols in your current workspace.
          -- Similar to document symbols, except searches over your entire project.
          opts.desc = 'Show workspace [S]ymbols'
          vim.keymap.set('n', '<leader>lS', builtin.lsp_dynamic_workspace_symbols, opts)

          -- Rename the variable under your cursor.
          -- Most Language Servers support renaming across files, etc.
          opts.desc = '[R]ename variable'
          vim.keymap.set('n', 'gR', vim.lsp.buf.rename, opts)

          -- Execute a code action, usually your cursor needs to be on top of an error
          -- or a suggestion from your LSP for this to activate.
          opts.desc = 'Execute code [a]ction'
          vim.keymap.set('n', '<leader>la', vim.lsp.buf.code_action, opts)

          local client = vim.lsp.get_client_by_id(event.data.client_id)

          -- Enable inlay hints (for Nvim v0.10.0 and onwards)
          -- ref: https://www.youtube.com/watch?v=DYaTzkw3zqQ
          if client and client.server_capabilities.inlayHintProvider and vim.lsp.inlay_hint then
            opts.desc = 'Toggle inlay [h]ints'
            vim.keymap.set('n', '<leader>lh', function()
              vim.lsp.inlay_hint.enable(0, not vim.lsp.inlay_hint.is_enabled())
            end, opts)
          end
        end
      })
    end
  },

  -- Status updates UI for LSP.
  -- ref: https://github.com/j-hui/fidget.nvim
  -- { 'j-hui/fidget.nvim' },
}
