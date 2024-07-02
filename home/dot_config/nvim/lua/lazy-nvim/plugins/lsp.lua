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
    keys = {
      { '<C-S-l>', '<cmd>Mason<CR>', desc = 'Open Mason popup window' },
    },
    opts = {
      ui = {
        icons = {
          package_installed = '✓',
          package_pending = '➜',
          package_uninstalled = '✗',
        },

        -- see https://github.com/williamboman/mason.nvim?tab=readme-ov-file#default-configuration
        keymaps = {},
      },
    },
  },

  -- help managing Mason package installation and updates
  -- ref: https://github.com/WhoIsSethDaniel/mason-tool-installer.nvim
  {
    'WhoIsSethDaniel/mason-tool-installer.nvim',
    name = 'mason-tool-installer',
    event = 'VeryLazy',
    dependencies = { 'mason' },
    opts = {
      auto_update = true,

      ensure_installed = {
        -- [[ LSPs ]]
        'lua_ls',
        'html',
        'cssls',
        'emmet-language-server',
        -- 'tailwindcss', -- had to disabled for now due to sluggish performance :(
        'tsserver',
        'jsonls',
        'marksman',
        'elixirls',

        -- [[ Formatters ]]
        'stylua',
        'prettierd',
        'prettier',

        -- [[ Linters ]]
        'eslint_d',
        'stylelint',
      },
    },
  },

  -- closes gaps that exist between mason.nvim and nvim-lspconfig
  -- ref: https://github.com/williamboman/mason-lspconfig.nvim
  {
    'williamboman/mason-lspconfig.nvim',
    name = 'mason-lspconfig',
    dependencies = { 'mason' },
  },

  -- To show LSP query results in a floating window instead of usual splits/tabs
  -- ref: https://github.com/rmagatti/goto-preview
  {
    'rmagatti/goto-preview',
    name = 'goto-preview',
    opts = {
      width = 80,
      height = 20,

      -- Whether to set the preview window title as the filename
      preview_window_title = { position = 'center' },

      references = {
        -- Use telescope's default layout configs
        telescope = {},
      },

      post_open_hook = function(bufnr, winnr)
        local utils = require 'lazy-nvim.lib.goto-preview-utils'

        local map = utils.create_key_mapper(bufnr)
        local open_preview = utils.create_open_previewer(winnr)

        local close_current = function()
          vim.cmd.wincmd 'q'
        end

        local close_all_wins = function()
          require('goto-preview').close_all_win()
        end

        map {
          { 'q', close_current, 'Preview: Close Current Window' },
          { 'Q', close_all_wins, 'Preview: Close All Windows' },
          { '<CR>', open_preview 'default', 'Preview: Replace Parent Window' },
          { '<C-s>', open_preview 'horizontal', 'Preview: Split Horizontally' },
          { '<C-v>', open_preview 'vertical', 'Preview: Split Vertically' },
          { '<C-t>', open_preview 'tab', 'Preview: Open in New Tab' },
        }
      end,
    },
  },

  -- actual configs and apis for the Nvim LSP client
  -- ref: https://github.com/neovim/nvim-lspconfig
  {
    'neovim/nvim-lspconfig',
    name = 'lspconfig',
    event = { 'BufReadPre', 'BufNewFile' },
    keys = {
      { '<leader>li', '<cmd>LspInfo<CR>', desc = 'LSP: Show Info' },
      { '<leader>lr', '<cmd>LspRestart<CR>', desc = 'LSP: Restart Current' },
    },
    dependencies = { 'mason-lspconfig' },
    config = function()
      local lspconfig = require 'lspconfig'
      local mason_lspconfig = require 'mason-lspconfig'
      local utils = require 'lazy-nvim.lib.lspconfig-utils'

      mason_lspconfig.setup_handlers {
        -- will be called for each installed server that doesn't have a dedicated handler
        function(server_name)
          lspconfig[server_name].setup {
            -- tell LSP servers what capabilities that the client (nvim) can handle
            capabilities = utils.make_capabilities(),
          }
        end,

        ['tsserver'] = function() end, -- delegated to typescript-tools plugin
      }

      -- manually setup nushell LSP server because there's no official version found on mason
      lspconfig.nushell.setup { capabilities = utils.make_capabilities() }

      -- will get run when an LSP attaches to a particular buffer
      vim.api.nvim_create_autocmd('LspAttach', {
        desc = 'Configure hover UIs and map keybindings when an LSP attached to a buffer',
        group = vim.api.nvim_create_augroup('lsp-attach-config', { clear = true }),
        callback = function(event)
          local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

          -- Setup lsp autocommands
          -- setup_highlight_references_hover(event)
          setup_inlay_hints(event)

          -- [[ Buffer local mappings ]]
          local opts = { buffer = event.buf, silent = true }

          -- Diagnostics Navigation
          local next_diagnostic, prev_diagnostic =
            ts_repeat_move.make_repeatable_move_pair(vim.diagnostic.goto_next, vim.diagnostic.goto_prev)

          opts.desc = 'LSP: Diagnostic'
          vim.keymap.set('n', ']d', next_diagnostic, opts)

          opts.desc = 'LSP: Diagnostic'
          vim.keymap.set('n', '[d', prev_diagnostic, opts)

          -- Opens a popup that displays documentation about the word under your cursor
          -- See `:help K` for why this keymap.
          opts.desc = 'LSP: Hover Documentation'
          vim.keymap.set('n', 'K', function()
            -- Show diagnostic at cursor position on hover
            -- ref: https://neovim.discourse.group/t/how-to-show-diagnostics-on-hover/3830
            local _, diagnostic_winid = vim.diagnostic.open_float(nil)
            if not diagnostic_winid then vim.lsp.buf.hover() end
          end, opts)

          -- Suggest help for a function parameter under the cursor
          opts.desc = 'LSP: Show Function Signature Help'
          vim.keymap.set({ 'n', 'i' }, '<C-S-Space>', vim.lsp.buf.signature_help, opts)

          -- Jump to the definition of the word under your cursor.
          -- This is where a variable was first declared, or where a function is defined, etc.
          -- To jump back, press <C-t>.
          opts.desc = 'LSP: Jump to Definition'
          vim.keymap.set('n', 'gd', "<cmd>lua require('goto-preview').goto_preview_definition()<CR>", opts)

          -- Jump to the type of the word under your cursor.
          -- Useful when you're not sure what type a variable is and you want to see
          -- the definition of its *type*, not where it was *defined*.
          opts.desc = 'LSP: Jump to Typedef'
          vim.keymap.set('n', 'gD', "<cmd>lua require('goto-preview').goto_preview_type_definition()<CR>", opts)

          -- Jump to the implementation of the word under your cursor.
          -- Useful when your language has ways of declaring types without an actual implementation.
          opts.desc = 'LSP: Jump to Implementation'
          vim.keymap.set('n', 'gI', "<cmd>lua require('goto-preview').goto_preview_implementation()<CR>", opts)

          -- Find all references for the word under your cursor.
          opts.desc = 'LSP: Show References'
          vim.keymap.set('n', 'gr', "<cmd>lua require('goto-preview').goto_preview_references()<CR>", opts)

          -- Rename the variable under your cursor.
          -- Most Language Servers support renaming across files, etc.
          opts.desc = 'LSP: Rename Variable'
          vim.keymap.set('n', 'gR', vim.lsp.buf.rename, opts)

          -- Execute a code action, usually your cursor needs to be on top of an error
          -- or a suggestion from your LSP for this to activate.
          opts.desc = 'LSP: Execute Code Action'
          vim.keymap.set('n', '<C-.>', vim.lsp.buf.code_action, opts)

          -- Fuzzy find all the symbols in your current document.
          -- Symbols are things like variables, functions, types, etc.
          opts.desc = 'LSP: Search Document Symbols'
          vim.keymap.set('n', '<leader>o', '<cmd>Telescope lsp_document_symbols<CR>', opts)

          -- Fuzzy find all the symbols in your current workspace.
          -- Similar to document symbols, except searches over your entire project.
          opts.desc = 'LSP: Search Workspace Symbols'
          vim.keymap.set('n', '<leader>O', '<cmd>Telescope lsp_dynamic_workspace_symbols<CR>', opts)
        end,
      })
    end,
  },

  {
    'folke/lazydev.nvim',
    name = 'lazydev',
    ft = 'lua',
    dependencies = { 'lspconfig' },
    opts = {},
  },

  {
    'pmizio/typescript-tools.nvim',
    name = 'typescript-tools',
    ft = {
      'javascript',
      'javascriptreact',
      'javascript.jsx',
      'typescript',
      'typescriptreact',
      'typescript.tsx',
    },
    dependencies = { 'plenary', 'lspconfig' },
    opts = {
      expose_as_code_action = 'all',
    },
  },
}
