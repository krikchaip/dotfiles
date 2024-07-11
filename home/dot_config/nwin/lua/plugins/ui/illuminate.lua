return {
  -- Spec Source
  'RRethy/vim-illuminate',
  name = 'illuminate',

  -- Spec Setup
  config = function()
    require('illuminate').configure {
      -- delay in milliseconds
      delay = 500,

      -- filetypes to not illuminate, this overrides filetypes_allowlist
      filetypes_denylist = {
        'DiffviewFileHistory',
        'DiffviewFiles',
        'DressingInput',
        'Navbuddy',
        'NvimTree',
        'TelescopePrompt',
        'TelescopeResults',
        'cmp_docs',
        'cmp_menu',
        'dashboard',
        'lazy',
        'noice',
      },

      -- number of lines at which to use large_file_config
      -- The `under_cursor` option is disabled when this cutoff is hit
      large_file_cutoff = 2500,

      -- case_insensitive_regex: sets regex case sensitivity
      case_insensitive_regex = false,
    }

    vim.cmd [[hi! default link IlluminatedWordText LspReferenceText]]
    vim.cmd [[hi! default link IlluminatedWordRead LspReferenceRead]]
    vim.cmd [[hi! default link IlluminatedWordWrite LspReferenceWrite]]
  end,

  -- Spec Lazy Loading
  event = 'User FilePost',
}
