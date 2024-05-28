return {
  {
    'antosha417/nvim-lsp-file-operations',
    name = 'lsp-file-operations',
    dependencies = { 'plenary' },
    opts = {},
  },

  {
    'b0o/nvim-tree-preview.lua',
    name = 'nvim-tree-preview',
    dependencies = { 'plenary', 'nvim-treesitter' },
    opts = {
      keymaps = {
        ['q'] = { action = 'close', unwatch = true },
        ['P'] = { action = 'toggle_focus' },
        ['<CR>'] = { open = 'edit' },
        ['<C-t>'] = { open = 'tab' },
        ['<C-v>'] = { open = 'vertical' },
        ['<C-s>'] = { open = 'horizontal' },
      },
    },
  },

  {
    'nvim-tree/nvim-tree.lua',
    name = 'nvim-tree',
    version = '*',
    keys = {
      { '<leader>e', '<cmd>NvimTreeFocus<CR>', desc = 'Explorer Open' },
      { '<leader>E', '<cmd>NvimTreeClose<CR>', desc = 'Explorer Close' },
    },
    dependencies = { 'web-devicons', 'lsp-file-operations', 'nvim-tree-preview' },
    opts = {
      -- Keeps the cursor on the first letter of the filename when moving in the tree
      hijack_cursor = true,

      -- Completely disable netrw
      disable_netrw = true,

      -- Necessary when using a UI prompt decorator such as dressing.nvim or telescope-ui-select.nvim
      select_prompts = true,

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
        -- If `false`, the height and width of windows other than nvim-tree will be equalized.
        preserve_window_proportions = false,

        -- Value can be 'yes', 'auto', 'no'
        signcolumn = 'no',

        -- Width of the window
        width = 25,

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
            -- Glyphs for git status
            git = {
              unstaged = '✗',
              staged = '✓',
              unmerged = '',
              renamed = '➜',
              untracked = '★',
              deleted = '',
              ignored = '◌',
            },
          },
        },
      },

      -- Update the focused file on `BufEnter`, un-collapses
      -- the folders recursively until it finds the file.
      update_focused_file = { enable = true },

      diagnostics = {
        -- LSP and COC diagnostics
        enable = true,

        -- Show diagnostic icons on parent directories
        show_on_dirs = true,

        -- Icons for diagnostic severity
        icons = {
          error = '',
          warning = '',
          hint = '',
          info = '',
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
            enable = false,

            -- string 'default' or a function returning
            -- the window id that will open the node, or 'nil'
            -- if an invalid window is picked or user cancelled the action
            -- picker = 'default',
            -- picker = require('window-picker').pick_window
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
          open = true,

          -- Closes the tree across all tabpages when the tree is closed
          close = true,

          -- List of filetypes or buffer names on new tab that will prevent nvim tree to open
          ignore = { 'help' },
        },
      },

      help = {
        -- 'key' (sort alphabetically by keymap)
        -- 'desc' (sort alphabetically by description)
        sort_by = 'desc',
      },

      on_attach = function(bufnr)
        require 'lazy-nvim.lib.nvim-tree-autocmd'

        -- local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'
        local utils = require 'lazy-nvim.lib.nvim-tree-utils'

        local api = require 'nvim-tree.api'

        local tree = api.tree
        local node = api.node
        local fs = api.fs
        local marks = api.marks

        local opts = {
          buffer = bufnr,
          silent = true,
          nowait = true,
          noremap = true,
        }

        local mappings = {
          ['Explorer'] = {
            ['?'] = { tree.toggle_help, 'Help' },
            ['q'] = { tree.close, 'Close' },
            ['<C-r>'] = { tree.reload, 'Refresh' },
          },

          ['Open'] = {
            ['l'] = { node.open.edit, 'Edit' },
            ['<CR>'] = { node.open.edit, 'Edit' },
            ['<2-LeftMouse>'] = { node.open.edit, 'Edit' },
            ['o'] = { node.run.system, 'System Default' },
            ['<M-RightMouse>'] = { node.run.system, 'System Default' },
          },

          ['Preview'] = {
            ['P'] = { utils.preview_current_node, 'Current Node' },
            ['<ESC>'] = { utils.close_preview, 'Close' },
          },

          ['Split'] = {
            ['<C-t>'] = { node.open.tab, 'New Tab' },
            ['<C-v>'] = { node.open.vertical, 'Vertical' },
            ['<C-s>'] = { node.open.horizontal, 'Horizontal' },
          },

          ['Directory'] = {
            ['h'] = { node.navigate.parent, 'Goto Parent' },
            ['<BS>'] = { node.navigate.parent_close, 'Close Current' },
            ['<S-BS>'] = { utils.collapse_all, 'Collapse All' },
            ['L'] = { tree.expand_all, 'Expand All' },
            ['gl'] = { tree.change_root_to_node, 'CD Into' },
            ['gh'] = { tree.change_root_to_parent, 'CD Parent' },
            ['gH'] = { utils.change_root_to_global_cwd, 'CD Root' },
          },

          ['Navigation'] = {
            ['<'] = { node.navigate.sibling.prev, 'Previous Sibling' },
            ['>'] = { node.navigate.sibling.next, 'Next Sibling' },

            ['[c'] = { node.navigate.git.prev_recursive, 'Prev Git' },
            [']c'] = { node.navigate.git.next_recursive, 'Next Git' },

            ['[d'] = { node.navigate.diagnostics.prev_recursive, 'Prev Diagnostic' },
            [']d'] = { node.navigate.diagnostics.next_recursive, 'Next Diagnostic' },
          },

          ['Copy'] = {
            ['Y'] = { fs.copy.filename, 'Filename' },
            ['yy'] = { fs.copy.filename, 'Filename' },
            ['yr'] = { fs.copy.relative_path, 'Relative Path' },
            ['ya'] = { fs.copy.absolute_path, 'Absolute Path' },
            ['yb'] = { fs.copy.basename, 'Basename' },
          },

          ['Rename'] = {
            ['R'] = { fs.rename, 'Filename' },
            ['rr'] = { fs.rename, 'Filename' },
            ['rf'] = { fs.rename_sub, 'Full Name' },
            ['ra'] = { fs.rename_full, 'Full Path' },
            ['rb'] = { fs.rename_basename, 'Basename' },
          },

          ['Operation'] = {
            ['i'] = { node.show_info_popup, 'Info' },
            ['a'] = { fs.create, 'Add' },
            ['D'] = { fs.remove, 'Delete' },
            ['dd'] = { fs.remove, 'Delete' },
            ['dt'] = { fs.trash, 'Trash' }, -- requires the homebrew package `trash`
            ['.'] = { node.run.cmd, 'Run Command' },
          },

          ['Search'] = {
            ['s'] = { utils.search_node, 'Reveal Node' },
            ['f'] = { api.live_filter.start, 'Start Filter' },
            ['F'] = { api.live_filter.clear, 'Clear Filter' },
          },

          ['Toggle'] = {
            ['\\a'] = { tree.toggle_enable_filters, 'All Filters' },
            ['\\m'] = { tree.toggle_no_bookmark_filter, 'Marks Filter' },
            ['\\b'] = { tree.toggle_no_buffer_filter, 'Buffer Filter' },
            ['\\c'] = { tree.toggle_git_clean_filter, 'Git Clean Filter' },
            ['\\i'] = { tree.toggle_gitignore_filter, 'Git Ignore Filter' },
            ['\\.'] = { tree.toggle_hidden_filter, 'Dotfiles Filter' },
            ['\\h'] = { tree.toggle_custom_filter, 'Hidden Filter' },
          },

          ['Marks'] = {
            ['v'] = { marks.toggle, 'Toggle Current' },
            ['c'] = { fs.copy.node, 'Toggle Copy Current' },
            ['x'] = { fs.cut, 'Toggle Cut Current' },
            ['p'] = { fs.paste, 'Paste Selected' },
            ['mp'] = { marks.bulk.move, 'Move Selected' },
            ['md'] = { marks.bulk.delete, 'Delete Selected' },
            ['mt'] = { marks.bulk.trash, 'Trash Selected' }, -- requires the homebrew package `trash`
            ['mm'] = { utils.clear_all, 'Clear All' },
            ['M'] = { utils.clear_all, 'Clear All' },
          },
        }

        -- Refactoring pattern for keymaps
        -- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#refactoring-of-on_attach-generated-code
        for group, mapping_group in pairs(mappings) do
          for key, mapping in pairs(mapping_group) do
            local kopts = vim.tbl_extend('force', opts, { desc = group .. ': ' .. mapping[2] })
            vim.keymap.set('n', key, mapping[1], kopts)
          end
        end
      end,
    },
    init = function()
      -- disable netrw at the very start of the plugin
      vim.g.loaded_netrw = 1
      vim.g.loaded_netrwPlugin = 1

      -- enable 24-bit colour
      vim.opt.termguicolors = true
    end,
  },
}
