local M = {}

function M.lazy()
  return {
    { '<leader>e', '<cmd>lua require("nvim-tree.api").tree.open()<CR>', desc = 'Explorer: Open' },
    { '<leader>E', '<cmd>lua require("nvim-tree.api").tree.close()<CR>', desc = 'Explorer: Close' },
    { '<leader>r', '<cmd>lua require("nvim-tree.api").tree.open { find_file = true }<CR>', desc = 'Explorer: Reveal' },
  }
end

function M.amend()
  local utils = require 'plugins.explorer.nvim-tree.utils'

  vim.keymap.set('n', 'q', utils.close_tree_if_last(), { desc = 'Buffer: Delete Current' })
  vim.keymap.set('n', 'Q', utils.close_tree_if_last(true), { desc = 'Buffer: Force Delete Current' })
end

function M.on_attach(bufnr)
  local api = require 'nvim-tree.api'
  local utils = require 'plugins.explorer.nvim-tree.utils'

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
      ['l'] = { node.open.tab_drop, 'Tab Drop' },
      ['<Right>'] = { node.open.tab_drop, 'Tab Drop' },
      ['<CR>'] = { node.open.tab_drop, 'Tab Drop' },
      ['<2-LeftMouse>'] = { node.open.tab_drop, 'Tab Drop' },
      ['<S-CR>'] = { node.open.edit, 'Replace' },
      ['o'] = { node.run.system, 'System Default' },
      ['<M-RightMouse>'] = { node.run.system, 'System Default' },
    },

    ['Preview'] = {
      ['P'] = { utils.preview_current_node, 'Current Node' },
      ['<ESC>'] = { utils.close_preview, 'Close' },
    },

    ['Split'] = {
      ['t'] = { node.open.tab, 'New Tab' },
      ['v'] = { node.open.vertical, 'Vertical' },
      ['s'] = { node.open.horizontal, 'Horizontal' },
    },

    ['Directory'] = {
      ['h'] = { node.navigate.parent, 'Goto Parent' },
      ['<Left>'] = { node.navigate.parent, 'Goto Parent' },
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
      ['e'] = { node.run.cmd, 'Run Command' },
    },

    ['Search'] = {
      ['f'] = { utils.search_node, 'Reveal Node' },
      ['F'] = { utils.fuzzy_under_node, 'Fuzzy Under Node' },
      ['\\f'] = { api.live_filter.start, 'Start Filter' },
      ['\\F'] = { api.live_filter.clear, 'Clear Filter' },
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
      ['.'] = { marks.toggle, 'Toggle Current' },
      ['c'] = { fs.copy.node, 'Toggle Copy Current' },
      ['x'] = { fs.cut, 'Toggle Cut Current' },
      ['p'] = { fs.paste, 'Paste Selected' },
      ['mp'] = { marks.bulk.move, 'Move Selected' },
      ['md'] = { marks.bulk.delete, 'Delete Selected' },
      ['mt'] = { marks.bulk.trash, 'Trash Selected' }, -- requires the homebrew package `trash`
      ['mm'] = { utils.clear_all, 'Clear All' },
      ['M'] = { utils.clear_all, 'Clear All' },
    },

    ['Diagnostics'] = {
      ['[d'] = { node.navigate.diagnostics.prev_recursive, 'Prev Suggestion' },
      [']d'] = { node.navigate.diagnostics.next_recursive, 'Next Suggestion' },
    },

    ['Git'] = {
      ['[c'] = { node.navigate.git.prev_recursive, 'Prev Change' },
      [']c'] = { node.navigate.git.next_recursive, 'Next Change' },

      ['S'] = { utils.git_add_toggle, 'Stage/Unstage Current' },
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
end

return M
