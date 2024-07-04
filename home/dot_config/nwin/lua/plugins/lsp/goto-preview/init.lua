-- To show LSP query results in a floating window instead of usual splits/tabs
-- ref: https://github.com/rmagatti/goto-preview
return {
  -- Spec Source
  'rmagatti/goto-preview',
  name = 'goto-preview',

  -- Spec Setup
  config = function()
    require 'plugins.lsp.goto-preview.setup'
  end,
}
