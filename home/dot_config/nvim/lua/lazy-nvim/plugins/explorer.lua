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
            ['<C-]>'] = { api.tree.change_root_to_node, 'CD' },
            ['<C-[>'] = { api.tree.change_root_to_parent, 'CD ..' },
          },

          ['Navigation'] = {
            ['<'] = { api.node.navigate.sibling.prev, 'Previous Sibling' },
            ['>'] = { api.node.navigate.sibling.next, 'Next Sibling' },

            ['J'] = { api.node.navigate.sibling.last, 'Last Sibling' },
            ['K'] = { api.node.navigate.sibling.first, 'First Sibling' },

            ['[c'] = { api.node.navigate.git.prev, 'Prev Git' },
            [']c'] = { api.node.navigate.git.next, 'Next Git' },

            ['[e'] = { api.node.navigate.diagnostics.prev, 'Prev Diagnostic' },
            [']e'] = { api.node.navigate.diagnostics.next, 'Next Diagnostic' },
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
            ['L'] = { api.node.open.toggle_group_empty, 'Group Empty' },
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
