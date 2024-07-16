-- A Collection of VSCode snippets across many different programming languages
return {
  -- Spec Source
  'rafamadriz/friendly-snippets',
  name = 'friendly-snippets',

  -- Spec Setup
  config = function()
    -- Enable standardized comments snippets
    require('luasnip').filetype_extend('lua', { 'luadoc' })
    require('luasnip').filetype_extend('sh', { 'shelldoc' })
    require('luasnip').filetype_extend('javascript', { 'jsdoc' })
    require('luasnip').filetype_extend('javascriptreact', { 'jsdoc' })
    require('luasnip').filetype_extend('typescript', { 'jsdoc' })
    require('luasnip').filetype_extend('typescriptreact', { 'jsdoc' })

    -- Add missing Javascript snippets
    require('luasnip').filetype_extend('typescript', { 'javascript' })
    require('luasnip').filetype_extend('typescriptreact', { 'javascript' })

    -- There're times that we write React code in normal Typescript files
    require('luasnip').filetype_extend('typescript', { 'typescriptreact' })

    -- You MUST call filetype_extends before calling lazy_load,
    -- Otherwise the extended snippets won't get load.
    -- ref: https://www.reddit.com/r/neovim/comments/1ahfg53/luasnip_cant_use_javascript_snippets_in
    require('luasnip.loaders.from_vscode').lazy_load()
  end,
}
