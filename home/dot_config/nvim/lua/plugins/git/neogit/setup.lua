require('neogit').setup {
  telescope_sorter = function()
    -- use the native fzf sorter from telescope extension
    return require('telescope').extensions.fzf.native_fzf_sorter()
  end,

  integrations = {
    -- If enabled, use telescope for menu selection rather than vim.ui.select.
    -- Allows multi-select and some things that vim.ui.select doesn't.
    telescope = true,

    -- Neogit only provides inline diffs. If you want a more traditional way to look at diffs, you can use `diffview`.
    -- The diffview integration enables the diff popup.
    diffview = true,
  },

  -- "ascii"   is the graph the git CLI generates
  -- "unicode" is the graph like https://github.com/rbong/vim-flog
  graph_style = 'unicode',

  -- Changes what mode the Commit Editor starts in.
  -- `true` will leave nvim in normal mode
  -- `false` will change nvim to insert mode
  -- `"auto"` will change nvim to insert mode IF the commit message is empty, otherwise leaving it in normal mode
  disable_insert_on_commit = false,

  -- Change the default way of opening Neogit status window
  -- values: 'tab' (default), 'split', 'vsplit', 'floating'
  kind = 'floating',

  popup = { kind = 'floating' },

  commit_editor = { kind = 'floating', show_staged_diff = false },

  commit_select_view = { kind = 'floating' },

  log_view = { kind = 'floating' },

  commit_view = { kind = 'floating' },

  reflog_view = { kind = 'floating' },

  preview_buffer = { kind = 'floating' },

  -- Configure each section in the Neogit status popup
  sections = {
    stashes = { folded = false },

    unpulled_upstream = { folded = false },

    unpulled_pushRemote = { folded = false },

    recent = { folded = false },

    rebase = { folded = false },
  },

  -- Set to false if you want to be responsible for creating _ALL_ keymappings
  use_default_keymaps = true,
}
