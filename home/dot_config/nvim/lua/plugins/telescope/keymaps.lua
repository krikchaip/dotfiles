return {
  lazy = function()
    local pickers = require 'plugins.telescope.pickers'

    local MENU = {
      { '<leader>b', '<cmd>Telescope builtin<CR>', desc = 'Search: Builtin Pickers' },
      { '<leader>h', '<cmd>Telescope help_tags<CR>', desc = 'Search: Help Pages' },
      { '<leader>H', '<cmd>Telescope man_pages<CR>', desc = 'Search: Man Pages' },
      { '<leader>:', '<cmd>Telescope commands<CR>', desc = 'Search: Plugin Commands' },
    }

    local SETTINGS = {
      { '<C-,>c', '<cmd>Telescope colorscheme<CR>', desc = 'Settings: Colorscheme' },
      { '<C-,><C-c>', '<cmd>Telescope colorscheme<CR>', desc = 'Settings: Colorscheme' },
      { '<C-,>o', '<cmd>Telescope vim_options<CR>', desc = 'Settings: Vim Options' },
      { '<C-,><C-o>', '<cmd>Telescope vim_options<CR>', desc = 'Settings: Vim Options' },
      { '<C-,>a', '<cmd>Telescope autocommands<CR>', desc = 'Settings: Autocommands' },
      { '<C-,><C-a>', '<cmd>Telescope autocommands<CR>', desc = 'Settings: Autocommands' },
      { '<C-,>k', '<cmd>Telescope keymaps<CR>', desc = 'Settings: Keymappings' },
      { '<C-,><C-k>', '<cmd>Telescope keymaps<CR>', desc = 'Settings: Keymappings' },
      { '<C-,>h', '<cmd>Telescope highlights<CR>', desc = 'Settings: Highlights' },
      { '<C-,><C-h>', '<cmd>Telescope highlights<CR>', desc = 'Settings: Highlights' },
      { '<C-,>,', pickers.find_chezmoi_files, desc = 'Settings: Dot Files' },
      { '<C-,><C-,>', pickers.find_chezmoi_files, desc = 'Settings: Dot Files' },
    }

    local HISTORY = {
      { '<leader>|', '<cmd>Telescope oldfiles<CR>', desc = 'Search: Buffer History' },
      { '<leader>?', '<cmd>Telescope search_history<CR>', desc = 'Search: Search History' },
      { '<leader>;', '<cmd>Telescope command_history<CR>', desc = 'Search: Command History' },
    }

    local NAVIGATION = {
      { '<leader><leader>', '<cmd>Telescope resume<CR>', desc = 'Picker: Resume Last' },
      { '<leader>\\', '<cmd>Telescope buffers<CR>', desc = 'Buffer: List Open' },
      { '<leader>p', pickers.find_files, desc = 'Explorer: List Files' },
      { '<leader>P', pickers.find_dirs, desc = 'Explorer: List Directories' },
    }

    local SEARCH = {
      { '<leader>*', '<cmd>Telescope grep_string<CR>', desc = 'Search: Workspace <cword>' },
      { '<leader>*', '<cmd>Telescope grep_string<CR>', desc = 'Search: Workspace Current Highlighted', mode = 'x' },
      { '<leader>/', pickers.local_fuzzy_find, desc = 'Search: Current Buffer' },
      { '<leader>f', pickers.workspace_fuzzy_find, desc = 'Search: Current Workspace' },
    }

    local GIT = {
      { '<leader>gb', '<cmd>Telescope git_branches<CR>', desc = 'Git: Manage Branches' },
    }

    return vim.iter({ MENU, SETTINGS, HISTORY, NAVIGATION, SEARCH, GIT }):flatten():totable()
  end,

  defaults = function()
    local a = require 'telescope.actions'
    local actions = require 'plugins.telescope.actions'

    return {
      ['<C-c>'] = false,
      ['<C-f>'] = false,
      ['<C-n>'] = false,
      ['<C-p>'] = false,
      ['<C-r><C-w>'] = false,
      ['<C-x>'] = false,
      ['<M-f>'] = false,

      -- close prompt with these instead of <C-c>
      ['<ESC>'] = 'close',
      ['<C-q>'] = 'close',

      -- result scrolling
      ['<C-j>'] = 'move_selection_next',
      ['<C-k>'] = 'move_selection_previous',
      ['<C-h>'] = 'results_scrolling_left',
      ['<C-l>'] = 'results_scrolling_right',
      ['<C-d>'] = 'results_scrolling_down',
      ['<C-u>'] = 'results_scrolling_up',

      -- preview scrolling
      ['<M-j>'] = actions.preview_scrolling_next,
      ['<M-k>'] = actions.preview_scrolling_previous,
      ['<M-h>'] = 'preview_scrolling_left',
      ['<M-l>'] = 'preview_scrolling_right',
      ['<M-d>'] = 'preview_scrolling_down',
      ['<M-u>'] = 'preview_scrolling_up',

      -- items selection for quickfix list
      ['<Tab>'] = 'toggle_selection',
      ['<S-Tab>'] = 'toggle_all',
      ['<S-Up>'] = a['toggle_selection'] + a['move_selection_previous'],
      ['<S-Down>'] = a['toggle_selection'] + a['move_selection_next'],

      -- open all selected results in tabs, splits, buffers
      ['<C-s>'] = actions.select_horizontal_or_multi,
      ['<C-v>'] = actions.select_vertical_or_multi,
      ['<C-t>'] = actions.select_tab_or_multi,

      -- cycle through Git previewers
      -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#mapping-c-sc-a-to-cycle-previewer-for-git-commits-to-show-full-message
      ['<C-S-left>'] = 'cycle_previewers_prev',
      ['<C-S-right>'] = 'cycle_previewers_next',
    }
  end,

  help_tags = function()
    local actions = require 'plugins.telescope.actions'
    return { ['<CR>'] = actions.select_vertical_or_multi }
  end,

  man_pages = function()
    local actions = require 'plugins.telescope.actions'
    return { ['<CR>'] = actions.select_vertical_or_multi }
  end,

  grep_string = function()
    return { ['<CR>'] = 'select_tab_drop', ['<S-CR>'] = 'select_default' }
  end,

  find_files = function()
    local actions = require 'plugins.telescope.actions'
    return {
      ['<CR>'] = 'select_tab_drop',
      ['<S-CR>'] = 'select_default',
      ['<M-r>'] = actions.reveal_in_nvim_tree,
    }
  end,

  oldfiles = function()
    return { ['<CR>'] = 'select_tab_drop', ['<S-CR>'] = 'select_default' }
  end,

  buffers = function()
    return {
      ['<CR>'] = 'select_tab_drop',
      ['<S-CR>'] = 'select_default',
      ['<M-d>'] = 'preview_scrolling_down',
      ['<C-c>'] = 'delete_buffer',
    }
  end,

  lsp_document_symbols = function()
    return { ['<C-Space>'] = 'complete_tag' }
  end,

  lsp_dynamic_workspace_symbols = function()
    return {
      ['<CR>'] = 'select_tab_drop',
      ['<S-CR>'] = 'select_default',
      ['<C-Space>'] = 'complete_tag',
    }
  end,
}
