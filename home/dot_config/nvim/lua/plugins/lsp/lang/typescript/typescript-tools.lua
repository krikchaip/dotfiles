return {
  -- Spec Source
  'pmizio/typescript-tools.nvim',
  name = 'typescript-tools',

  -- Spec Loading
  dependencies = { 'lspconfig' },

  -- Spec Setup
  config = function()
    require('typescript-tools').setup {
      single_file_support = true,

      capabilities = require('plugins.lsp.lspconfig.utils').create_capabilities(),
      on_attach = require('plugins.lsp.lspconfig.utils').on_attach,

      settings = {
        -- specify commands exposed as code_actions
        expose_as_code_action = 'all',

        tsserver_file_preferences = {
          includeInlayParameterNameHints = 'all',
          includeInlayParameterNameHintsWhenArgumentMatchesName = false,
          includeInlayFunctionParameterTypeHints = true,
          includeInlayVariableTypeHints = true,
          includeInlayVariableTypeHintsWhenTypeMatchesName = false,
          includeInlayPropertyDeclarationTypeHints = true,
          includeInlayFunctionLikeReturnTypeHints = true,
          includeInlayEnumMemberValueHints = true,
        },
      },
    }
  end,

  -- Spec Lazy Loading
  ft = {
    'javascript',
    'javascriptreact',
    'javascript.jsx',
    'typescript',
    'typescriptreact',
    'typescript.tsx',
  },
}
