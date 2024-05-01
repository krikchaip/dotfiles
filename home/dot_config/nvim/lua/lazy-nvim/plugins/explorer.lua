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
          diagnostics_placement = 'after',

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

      on_attach = function(bufnr)
        -- local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        local api = require 'nvim-tree.api'

        local opts = {
          buffer = bufnr,
          silent = true,
          nowait = true,
          noremap = true,
        }

        local mappings = {
          ['Explorer'] = {
            ['?'] = { api.tree.toggle_help, 'Help' },
            ['R'] = { api.tree.reload, 'Refresh' },
            ['q'] = { api.tree.close, 'Close' },
          },

          ['Open'] = {
            ['<CR>'] = { api.node.open.edit, 'Edit' },
            ['<2-LeftMouse>'] = { api.node.open.edit, 'Edit' },
            ['o'] = { api.node.open.edit, 'Edit' },
            ['O'] = { api.node.open.no_window_picker, 'No Window Picker' },
            ['<Tab>'] = { api.node.open.preview, 'Preview' },
            ['s'] = { api.node.run.system, 'In System' },
          },

          ['Split'] = {
            ['<C-t>'] = { api.node.open.tab, 'New Tab' },
            ['<C-v>'] = { api.node.open.vertical, 'Vertical' },
            ['<C-s>'] = { api.node.open.horizontal, 'Horizontal' },
          },

          ['Directory'] = {
            ['<BS>'] = { api.node.navigate.parent_close, 'Close Current' },
            ['P'] = { api.node.navigate.parent, 'Goto Parent' },
            ['W'] = { api.tree.collapse_all, 'Collapse All' },
            ['E'] = { api.tree.expand_all, 'Expand All' },
            ['gd'] = { api.tree.change_root_to_node, 'CD' },
            ['gu'] = { api.tree.change_root_to_parent, 'CD ..' },
          },

          ['Navigation'] = {
            ['<'] = { api.node.navigate.sibling.prev, 'Previous Sibling' },
            ['>'] = { api.node.navigate.sibling.next, 'Next Sibling' },

            ['J'] = { api.node.navigate.sibling.last, 'Last Sibling' },
            ['K'] = { api.node.navigate.sibling.first, 'First Sibling' },

            ['[c'] = { api.node.navigate.git.prev, 'Prev Git' },
            [']c'] = { api.node.navigate.git.next, 'Next Git' },

            ['[d'] = { api.node.navigate.diagnostics.prev, 'Prev Diagnostic' },
            [']d'] = { api.node.navigate.diagnostics.next, 'Next Diagnostic' },
          },

          ['Copy'] = {
            ['c'] = { api.fs.copy.node, 'Current Node' },
            ['y'] = { api.fs.copy.filename, 'Filename' },
            ['Y'] = { api.fs.copy.relative_path, 'Relative Path' },
            ['gy'] = { api.fs.copy.absolute_path, 'Absolute Path' },
            ['ge'] = { api.fs.copy.basename, 'Basename' },
          },

          ['Rename'] = {
            ['<C-r>'] = { api.fs.rename_sub, 'Omit Filename' },
            ['r'] = { api.fs.rename, 'Filename' },
            ['e'] = { api.fs.rename_basename, 'Basename' },
            ['u'] = { api.fs.rename_full, 'Full Path' },
          },

          ['Operation'] = {
            ['i'] = { api.node.show_info_popup, 'Info' },
            ['a'] = { api.fs.create, 'Add' },
            ['d'] = { api.fs.remove, 'Delete' },
            ['D'] = { api.fs.trash, 'Trash' },
            ['p'] = { api.fs.paste, 'Paste' },
            ['x'] = { api.fs.cut, 'Cut' },
            ['.'] = { api.node.run.cmd, 'Run Command' },
          },

          ['Search'] = {
            ['S'] = { api.tree.search_node, 'Exact' },
            ['f'] = { api.live_filter.start, 'Start Filter' },
            ['F'] = { api.live_filter.clear, 'Clear Filter' },
          },

          ['Toggle'] = {
            -- ['L'] = { api.node.open.toggle_group_empty, 'Group Empty' },
            ['M'] = { api.tree.toggle_no_bookmark_filter, 'Marks Filter' },
            ['B'] = { api.tree.toggle_no_buffer_filter, 'Buffer Filter' },
            ['C'] = { api.tree.toggle_git_clean_filter, 'Git Clean Filter' },
            ['I'] = { api.tree.toggle_gitignore_filter, 'Git Ignore Filter' },
            ['H'] = { api.tree.toggle_hidden_filter, 'Dotfiles Filter' },
            ['U'] = { api.tree.toggle_custom_filter, 'Hidden Filter' },
          },

          ['Marks'] = {
            ['m'] = { api.marks.toggle, 'Toggle Current' },
            ['bd'] = { api.marks.bulk.delete, 'Delete Selected' },
            ['bt'] = { api.marks.bulk.trash, 'Trash Selected' },
            ['bmv'] = { api.marks.bulk.move, 'Move Selected' },
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
      api.tree.open()
    end
  },
}
