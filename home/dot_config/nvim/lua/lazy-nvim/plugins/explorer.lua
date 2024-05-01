return {
  {
    'nvim-tree/nvim-tree.lua',
    name = 'nvim-tree',
    version = '*',
    lazy = false,
    dependencies = { 'web-devicons', 'image' },
    opts = {
      disable_netrw = true,
      hijack_netrw = true,

      on_attach = function(bufnr)
        -- local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

        local api = require 'nvim-tree.api'

        local opts = {
          buffer = bufnr,
          silent = true,
          nowait = true,
          noremap = true,
        }

        -- ['>'] = {  api.node.navigate.sibling.next, 'Next Sibling' },
        -- ['<'] = {  api.node.navigate.sibling.prev, 'Previous Sibling' },
        -- ['J'] = {  api.node.navigate.sibling.last, 'Last Sibling' },
        -- ['K'] = {  api.node.navigate.sibling.first, 'First Sibling' },

        -- ['S'] = {  api.tree.search_node, 'Search' },
        -- ['F'] = {  api.live_filter.clear, 'Live Filter: Clear' },
        -- ['f'] = {  api.live_filter.start, 'Live Filter: Start' },

        -- ['<C-]>'] = {  api.tree.change_root_to_node, 'CD: Into Node' },
        -- ['<C-[>'] = {  api.tree.change_root_to_parent, 'CD: Up' },

        -- ['bd'] = {  api.marks.bulk.delete, 'Delete Bookmarked' },
        -- ['bt'] = {  api.marks.bulk.trash, 'Trash Bookmarked' },
        -- ['bmv'] = {  api.marks.bulk.move, 'Move Bookmarked' },
        -- ['m'] = {  api.marks.toggle, 'Toggle Bookmark' },

        -- ['[c'] = {  api.node.navigate.git.prev, 'Prev Git' },
        -- [']c'] = {  api.node.navigate.git.next, 'Next Git' },
        -- [']e'] = {  api.node.navigate.diagnostics.next, 'Next Diagnostic' },
        -- ['[e'] = {  api.node.navigate.diagnostics.prev, 'Prev Diagnostic' },

        -- ['L'] = {  api.node.open.toggle_group_empty, 'Toggle Group Empty' },
        -- ['B'] = {  api.tree.toggle_no_buffer_filter, 'Toggle Filter: No Buffer' },
        -- ['C'] = {  api.tree.toggle_git_clean_filter, 'Toggle Filter: Git Clean' },
        -- ['M'] = {  api.tree.toggle_no_bookmark_filter, 'Toggle Filter: No Bookmark' },
        -- ['H'] = {  api.tree.toggle_hidden_filter, 'Toggle Filter: Dotfiles' },
        -- ['I'] = {  api.tree.toggle_gitignore_filter, 'Toggle Filter: Git Ignore' },
        -- ['U'] = {  api.tree.toggle_custom_filter, 'Toggle Filter: Hidden' },

        -- ['c'] = {  api.fs.copy.node, 'Copy' },
        -- ['y'] = {  api.fs.copy.filename, 'Copy Name' },
        -- ['Y'] = {  api.fs.copy.relative_path, 'Copy Relative Path' },
        -- ['gy'] = {  api.fs.copy.absolute_path, 'Copy Absolute Path' },
        -- ['ge'] = {  api.fs.copy.basename, 'Copy Basename' },

        -- ['<C-r>'] = {  api.fs.rename_sub, 'Rename: Omit Filename' },
        -- ['e'] = {  api.fs.rename_basename, 'Rename: Basename' },
        -- ['r'] = {  api.fs.rename, 'Rename' },
        -- ['u'] = {  api.fs.rename_full, 'Rename: Full Path' },

        -- ['i'] = {  api.node.show_info_popup, 'Info' },
        -- ['a'] = {  api.fs.create, 'Create File Or Directory' },
        -- ['d'] = {  api.fs.remove, 'Delete' },
        -- ['D'] = {  api.fs.trash, 'Trash' },
        -- ['p'] = {  api.fs.paste, 'Paste' },
        -- ['x'] = {  api.fs.cut, 'Cut' },

        -- ['.'] = {  api.node.run.cmd, 'Run Command' },
        -- ['s'] = {  api.node.run.system, 'Run System' },

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
