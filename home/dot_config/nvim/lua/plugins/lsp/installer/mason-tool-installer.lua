local LSP = {
  'lua-language-server',
  'emmet-language-server',
  'dockerfile-language-server',
  'yaml-language-server',

  'html-lsp',
  'css-lsp',
  'json-lsp',

  'elixir-ls',

  'gopls',

  'marksman',

  -- had to disabled for now due to sluggish performance :(
  -- 'tailwindcss-language-server',
}

local FORMATTER = {
  'prettier',
  'prettierd',

  'stylua',
}

local LINTER = {
  'eslint_d',
  'stylelint',
}

-- help managing Mason package installation and updates
-- ref: https://github.com/WhoIsSethDaniel/mason-tool-installer.nvim
return {
  -- Spec Source
  'WhoIsSethDaniel/mason-tool-installer.nvim',
  name = 'mason-tool-installer',

  -- Spec Loading
  dependencies = { 'mason' },

  -- Spec Setup
  config = function()
    require('mason-tool-installer').setup {
      auto_update = true,
      ensure_installed = list_concat(LSP, FORMATTER, LINTER),
    }
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
  cmd = { 'MasonToolsInstall', 'MasonToolsInstallSync' },
}
