local keymaps = require 'plugins.telescope.keymaps'
local telescope = require 'telescope'

telescope.setup {
  defaults = {
    -- don't cycle results when scrolling past the last/first item
    -- scroll_strategy = 'limit',

    -- determine where should the selection starts (top/bottom)
    -- values: 'descending' | 'ascending'
    sorting_strategy = 'ascending',

    layout_strategy = 'vertical',
    layout_config = {
      vertical = {
        prompt_position = 'top',
        mirror = true,
        width = { 0.8, max = 90 },
        height = { 0.8, max = 37 },
        preview_height = { 0, min = 20 },
      },
    },

    -- these args will be used for `live_grep` and `grep_string`
    vimgrep_arguments = {
      'rg',
      '--color=never',
      '--no-heading',
      '--with-filename',
      '--line-number',
      '--column',
      '--smart-case',

      -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
      '--hidden',

      -- Exclude some search results in these files
      '--glob',
      '!**/.git/*',
      '--glob',
      '!**/pnpm-lock.yaml',
      '--glob',
      '!**/yarn.lock',
      '--glob',
      '!**/package-lock.json',

      -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#ripgrep-remove-indentation
      -- '--trim',
    },

    mappings = { i = keymaps.defaults() },
  },

  pickers = {
    help_tags = { mappings = { i = keymaps.help_tags() } },
    man_pages = { mappings = { i = keymaps.man_pages() } },

    colorscheme = { enable_preview = true },

    grep_string = {
      path_display = { 'tail' },
      mappings = { i = keymaps.grep_string() },
    },

    find_files = {
      -- `hidden = true` will still show the inside of `.git/` as it's not specified in `.gitignore`.
      -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
      find_command = { 'fd', '--type', 'file', '--hidden', '--exclude', '**/.git/*' },
      mappings = { i = keymaps.find_files() },
    },

    oldfiles = { mappings = { i = keymaps.oldfiles() } },

    buffers = {
      ignore_current_buffer = true,
      sort_lastused = true,
      mappings = { i = keymaps.buffers() },
    },

    lsp_definitions = { jump_type = 'tab drop', reuse_win = true },
    lsp_type_definitions = { jump_type = 'tab drop', reuse_win = true },
    lsp_implementations = { jump_type = 'tab drop', reuse_win = true },

    lsp_references = {
      jump_type = 'tab drop',
      include_declaration = false,
      include_current_line = true,
    },

    lsp_document_symbols = { mappings = { i = keymaps.lsp_document_symbols() } },
    lsp_dynamic_workspace_symbols = { mappings = { i = keymaps.lsp_dynamic_workspace_symbols() } },
  },
}

-- Enable Telescope extensions if they are installed
telescope.load_extension 'fzf'
