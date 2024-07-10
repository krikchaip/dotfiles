require('scrollbar').setup {
  show_in_active_only = true,

  -- Hides everything if all lines are visible
  hide_if_all_visible = true,

  handle = {
    -- 0 for fully opaque and 100 to full transparent
    blend = 10,
  },

  marks = {
    Search = { highlight = 'CursorLineNr' },
    GitAdd = { text = '┃' },
    GitChange = { text = '┃' },
    GitDelete = { text = '~' },
  },

  excluded_buftypes = {
    -- default values
    'terminal',
  },

  excluded_filetypes = {
    -- default values
    'cmp_docs',
    'cmp_menu',
    'noice',
    'prompt',
    'TelescopePrompt',
    '',

    -- custom values
    'DiffviewFileHistory',
    'DiffviewFiles',
    'DressingInput',
    'Navbuddy',
    'NvimTree',
  },

  handlers = {
    -- Requires gitsigns
    gitsigns = true,

    -- Requires hlslens
    search = true,
  },
}
