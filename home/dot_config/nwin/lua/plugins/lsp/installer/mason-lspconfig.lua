-- closes gaps that exist between mason.nvim and nvim-lspconfig
-- ref: https://github.com/williamboman/mason-lspconfig.nvim
return {
  -- Spec Source
  'williamboman/mason-lspconfig.nvim',
  name = 'mason-lspconfig',

  -- Spec Loading
  dependencies = { 'mason' },
}
