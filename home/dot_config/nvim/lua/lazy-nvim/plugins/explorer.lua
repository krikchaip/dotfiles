return {
  {
    'nvim-tree/nvim-tree.lua',
    name = 'nvim-tree',
    version = '*',
    lazy = false,
    dependencies = { 'web-devicons', 'image', 'statuscol' },
    opts = {
      -- Keeps the cursor on the first letter of the filename when moving in the tree
      hijack_cursor = false,

      -- Completely disable netrw
      disable_netrw = true,

      -- Necessary when using a UI prompt decorator such as dressing.nvim or telescope-ui-select.nvim
      select_prompts = false,

      sort = {
        -- Changes how files within the same directory are sorted.
        -- Can be one of 'name', 'case_sensitive', 'modification_time',
        -- 'extension', 'suffix', 'filetype' or a function.
        sorter = 'extension',
      },

      view = {
        -- When entering nvim-tree, reposition the view
        -- so that the current node is initially centralized, like pressing `zz`
        centralize_selection = false,

        -- Preserves window proportions when opening a file
        -- If `false`, the height and width of windows other than nvim-tree will be equalized.
        preserve_window_proportions = false,

        -- Value can be 'yes', 'auto', 'no'
        signcolumn = 'yes',

        -- Width of the window
        width = 25,

        -- Use nvim-tree in a floating window
        -- float = { enable = true },
      },

      renderer = {
        -- Compact folders that only contain a single folder into one node
        group_empty = true,

        -- Display excessive node name in a floating window
        full_name = true,

        -- See `:help filename-modifiers` for available `string` options
        root_folder_label = ':~:s?$??',

        -- Number of spaces for an each tree nesting level
        indent_width = 1,

        -- Display indent markers when folders are open
        -- indent_markers = { enable = false },

        -- A list of filenames that gets special highlighted
        -- special_files = { 'Cargo.toml', 'Makefile', 'README.md', 'readme.md' },

        -- Enable highlight for git attributes
        -- values: 'none', 'icon', 'name', 'all'
        highlight_git = 'name',

        -- Enable highlight for diagnostics
        -- values: 'none', 'icon', 'name', 'all'
        highlight_diagnostics = 'none',

        -- Highlight icons and/or names for bufloded() files
        -- values: 'none', 'icon', 'name', 'all'
        highlight_opened_files = 'none',

        -- Highlight icons and/or names for modified files
        -- values: 'none', 'icon', 'name', 'all'
        highlight_modified = 'icon',

        -- Highlight bookmarked nodes
        -- values: 'none', 'icon', 'name', 'all'
        highlight_bookmarks = 'none',

        -- Enable highlight for clipboard items
        -- values: 'none', 'icon', 'name', 'all'
        highlight_clipboard = 'none',

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
          bookmarks_placement = 'signcolumn',

          glyphs = {
            -- Glyphs for git status
            git = {
              unstaged  = '✗',
              staged    = '✓',
              unmerged  = '',
              renamed   = '➜',
              untracked = '★',
              deleted   = '',
              ignored   = '◌',
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
          error   = '',
          warning = '',
          hint    = '',
          info    = '',
        },
      },

      -- Indicate which file have unsaved modification
      -- requires renderer.icons.show.modified = true
      --       OR renderer.highlight_modified = true
      modified = { enable = true },

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
          resize_window = false,

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
        },
      },

      help = {
        -- 'key' (sort alphabetically by keymap)
        -- 'desc' (sort alphabetically by description)
        sort_by = 'desc',
      },

      on_attach = function(bufnr)
        -- local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

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
            ['R'] = { tree.reload, 'Refresh' },
            ['q'] = { tree.close, 'Close' },
          },

          ['Open'] = {
            ['<CR>'] = { node.open.drop, 'Edit' },
            ['<2-LeftMouse>'] = { node.open.drop, 'Edit' },
            ['o'] = { node.open.drop, 'Edit' },
            ['O'] = { node.open.no_window_picker, 'No Window Picker' },
            ['<Tab>'] = { node.open.preview, 'Preview' },
            ['s'] = { node.run.system, 'In System' },
          },

          ['Split'] = {
            ['<C-t>'] = { node.open.tab_drop, 'New Tab' },
            ['<C-v>'] = { node.open.vertical, 'Vertical' },
            ['<C-s>'] = { node.open.horizontal, 'Horizontal' },
          },

          ['Directory'] = {
            ['<BS>'] = { node.navigate.parent_close, 'Close Current' },
            ['P'] = { node.navigate.parent, 'Goto Parent' },
            ['W'] = { function() tree.collapse_all(true) end, 'Collapse All' },
            ['E'] = { tree.expand_all, 'Expand All' },
            ['gd'] = { tree.change_root_to_node, 'CD' },
            ['gu'] = { tree.change_root_to_parent, 'CD ..' },
          },

          ['Navigation'] = {
            ['<'] = { node.navigate.sibling.prev, 'Previous Sibling' },
            ['>'] = { node.navigate.sibling.next, 'Next Sibling' },

            ['J'] = { node.navigate.sibling.last, 'Last Sibling' },
            ['K'] = { node.navigate.sibling.first, 'First Sibling' },

            ['[c'] = { node.navigate.git.prev_recursive, 'Prev Git' },
            [']c'] = { node.navigate.git.next_recursive, 'Next Git' },

            ['[d'] = { node.navigate.diagnostics.prev_recursive, 'Prev Diagnostic' },
            [']d'] = { node.navigate.diagnostics.next_recursive, 'Next Diagnostic' },
          },

          ['Copy'] = {
            ['c'] = { fs.copy.node, 'Current Node' },
            ['y'] = { fs.copy.filename, 'Filename' },
            ['Y'] = { fs.copy.relative_path, 'Relative Path' },
            ['gy'] = { fs.copy.absolute_path, 'Absolute Path' },
            ['ge'] = { fs.copy.basename, 'Basename' },
          },

          ['Rename'] = {
            ['<C-r>'] = { fs.rename_sub, 'Omit Filename' },
            ['r'] = { fs.rename, 'Filename' },
            ['e'] = { fs.rename_basename, 'Basename' },
            ['u'] = { fs.rename_full, 'Full Path' },
          },

          ['Operation'] = {
            ['i'] = { node.show_info_popup, 'Info' },
            ['a'] = { fs.create, 'Add' },
            ['d'] = { fs.remove, 'Delete' },
            ['D'] = { fs.trash, 'Trash' }, -- requires the homebrew package `trash`
            ['p'] = { fs.paste, 'Paste' },
            ['x'] = { fs.cut, 'Cut' },
            ['.'] = { node.run.cmd, 'Run Command' },
          },

          ['Search'] = {
            ['S'] = { tree.search_node, 'Exact' },
            ['f'] = { api.live_filter.start, 'Start Filter' },
            ['F'] = { api.live_filter.clear, 'Clear Filter' },
          },

          ['Toggle'] = {
            -- ['L'] = { node.open.toggle_group_empty, 'Group Empty' },
            ['M'] = { tree.toggle_no_bookmark_filter, 'Marks Filter' },
            ['B'] = { tree.toggle_no_buffer_filter, 'Buffer Filter' },
            ['C'] = { tree.toggle_git_clean_filter, 'Git Clean Filter' },
            ['I'] = { tree.toggle_gitignore_filter, 'Git Ignore Filter' },
            ['H'] = { tree.toggle_hidden_filter, 'Dotfiles Filter' },
            ['U'] = { tree.toggle_custom_filter, 'Hidden Filter' },
          },

          ['Marks'] = {
            ['m'] = { marks.toggle, 'Toggle Current' },
            ['bd'] = { marks.bulk.delete, 'Delete Selected' },
            ['bt'] = { marks.bulk.trash, 'Trash Selected' },
            ['bmv'] = { marks.bulk.move, 'Move Selected' },
            ['bc'] = { marks.clear, 'Clear All' },
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
      vim.g.loaded_netrw       = 1
      vim.g.loaded_netrwPlugin = 1

      -- enable 24-bit colour
      vim.opt.termguicolors    = true
    end,
    config = function(_, opts)
      local nvim_tree = require 'nvim-tree'
      local api = require 'nvim-tree.api'

      nvim_tree.setup(opts)

      -- open nvim-tree after setup finished
      -- api.tree.open()

      vim.keymap.set('n', '<leader>ef', api.tree.open, { desc = '[f]ocus' })

      vim.keymap.set('n', '<leader>ee', function()
        api.tree.toggle { focus = false }
      end, { desc = 'Toggl[e]' })

      vim.keymap.set('n', '<leader>er', function()
        api.tree.find_file { open = true, focus = false }
      end, { desc = '[r]eveal' })
    end
  },
}
