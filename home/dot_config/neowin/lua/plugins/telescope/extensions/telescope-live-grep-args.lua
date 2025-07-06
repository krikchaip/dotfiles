-- Enable passing arguments directly to `rg`
-- ref: https://github.com/nvim-telescope/telescope-live-grep-args.nvim
return {
  -- Spec Source
  'nvim-telescope/telescope-live-grep-args.nvim',
  name = 'telescope-live-grep-args',

  -- Spec Loading
  dependencies = { 'telescope' },

  -- Spec Versioning
  version = '^1.1.0',
}
