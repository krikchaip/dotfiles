-- this is specifically for 'BufEnter' autocommand
vim.g.nvim_tree_autoreveal = true

require('nvim-tree').setup {
  -- Keeps the cursor on the first letter of the filename when moving in the tree
  hijack_cursor = true,

  -- Completely disable netrw
  disable_netrw = true,

  -- Necessary when using a UI prompt decorator such as dressing.nvim or telescope-ui-select.nvim
  select_prompts = true,

  -- Changes the tree root directory on `DirChanged` and refreshes the tree.
  sync_root_with_cwd = true,

  -- Automatically reloads the tree on `BufEnter` nvim-tree
  reload_on_bufenter = true,

  sort = {
    -- Changes how files within the same directory are sorted.
    -- Can be one of 'name', 'case_sensitive', 'modification_time',
    -- 'extension', 'suffix', 'filetype' or a function.
    sorter = 'extension',
  },

  view = {
    -- When entering nvim-tree, reposition the view
    -- so that the current node is initially centralized, like pressing `zz`
    centralize_selection = true,

    -- Preserves window proportions when opening a file
    -- If `false`, the height and width of windows other than nvim-tree will be automatically equalized.
    -- If `true`, the height and width of windows other than nvim-tree will be preserved.
    preserve_window_proportions = false,

    -- Value can be 'yes', 'auto', 'no'
    signcolumn = 'yes',

    -- Width of the window
    width = 30,

    -- Use nvim-tree in a floating window
    -- float = { enable = true },
  },

  renderer = {
    -- Compact folders that only contain a single folder into one node
    group_empty = false,

    -- Display excessive node name in a floating window
    full_name = true,

    -- See `:help filename-modifiers` for available `string` options
    root_folder_label = ':~:s?$??',

    -- Number of spaces for an each tree nesting level
    indent_width = 1,

    indent_markers = {
      -- Display indent markers when folders are open
      enable = false,

      -- Display folder arrows in the same column as indent marker
      inline_arrows = false,
    },

    -- A list of filenames that gets special highlighted
    -- special_files = { 'Cargo.toml', 'Makefile', 'README.md', 'readme.md' },

    -- Enable highlight for git attributes
    -- values: 'none', 'icon', 'name', 'all'
    highlight_git = 'name',

    -- Enable highlight for diagnostics
    -- values: 'none', 'icon', 'name', 'all'
    highlight_diagnostics = 'name',

    -- Highlight icons and/or names for bufloded() files
    -- values: 'none', 'icon', 'name', 'all'
    highlight_opened_files = 'none',

    -- Highlight icons and/or names for modified files
    -- values: 'none', 'icon', 'name', 'all'
    highlight_modified = 'none',

    -- Highlight bookmarked nodes
    -- values: 'none', 'icon', 'name', 'all'
    highlight_bookmarks = 'none',

    -- Enable highlight for clipboard items
    -- values: 'none', 'icon', 'name', 'all'
    highlight_clipboard = 'name',

    icons = {
      web_devicons = {
        -- Show web-devicons on folders
        folder = { enable = true },
      },

      -- Place where the git icons will be rendered
      -- values: 'before', 'after', 'signcolumn'
      git_placement = 'after',

      -- Place where the diagnostics icon will be rendered
      -- values: 'before', 'after', 'signcolumn'
      diagnostics_placement = 'signcolumn',

      -- Place where the modified icon will be rendered
      -- values: 'before', 'after', 'signcolumn'
      modified_placement = 'after',

      -- Place where the bookmarks icon will be rendered
      -- values: 'before', 'after', 'signcolumn'
      bookmarks_placement = 'before',

      glyphs = {
        bookmark = '⌖', -- fix icon missing somehow?
      },
    },
  },

  -- Update the focused file on `BufEnter`, un-collapses
  -- the folders recursively until it finds the file.
  -- NOTE: already handled this via custom implementation
  update_focused_file = { enable = false },

  diagnostics = {
    -- LSP and COC diagnostics
    enable = true,

    -- Show diagnostic icons on parent directories
    show_on_dirs = true,

    -- Icons for diagnostic severity
    icons = {
      error = vim.g.diagnostic_signs.Error,
      warning = vim.g.diagnostic_signs.Warn,
      hint = vim.g.diagnostic_signs.Hint,
      info = vim.g.diagnostic_signs.Info,
    },
  },

  -- Indicate which file have unsaved modification
  -- requires renderer.icons.show.modified = true
  --       OR renderer.highlight_modified = true
  modified = { enable = false },

  filters = {
    -- Hide .git directory
    -- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Tips#hide-git-directory
    custom = { '^.git$' },
  },

  live_filter = {
    -- Whether to filter folders or not
    always_show_folders = false,
  },

  actions = {
    change_dir = {
      -- Restrict changing to a directory above the global cwd
      restrict_above_cwd = true,
    },

    expand_all = {
      -- A list of directories that should not be expanded automatically
      exclude = { '.git', 'target', 'build' },
    },

    open_file = {
      -- Resizes the tree when opening a file
      resize_window = true,

      window_picker = {
        -- If the feature is not enabled, files will open in
        -- window from which you last opened the tree
        -- WARN: turning this option on may affect nvim's performance
        enable = false,

        -- string 'default' or a function returning
        -- the window id that will open the node, or 'nil'
        -- if an invalid window is picked or user cancelled the action
        picker = require('window-picker').pick_window,
      },
    },

    remove_file = {
      -- Close any window displaying a file when removing the file from the tree
      close_window = true,
    },
  },

  tab = {
    -- Configuration for syncing nvim-tree across tabs
    sync = {
      -- Opens the tree automatically when switching tabpage or opening a new
      -- tabpage if the tree was previously open.
      open = false,

      -- Closes the tree across all tabpages when the tree is closed
      close = false,

      -- List of filetypes or buffer names on new tab that will prevent nvim tree to open
      ignore = { 'help', 'DiffviewFiles', 'DiffviewFileHistory' },
    },
  },

  help = {
    -- 'key' (sort alphabetically by keymap)
    -- 'desc' (sort alphabetically by description)
    sort_by = 'desc',
  },

  on_attach = require('plugins.explorer.nvim-tree.keymaps').on_attach,
}
