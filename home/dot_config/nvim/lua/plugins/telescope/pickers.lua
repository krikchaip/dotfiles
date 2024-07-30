local M = {}

-- Find files from project's root cwd
function M.find_files(opts)
  opts = opts or {}

  opts.cwd = opts.cwd or vim.loop.cwd()

  require('telescope.builtin').find_files(opts)
end

-- Find chezmoi files using `find_files` instead since its extension does not work somehow
function M.find_chezmoi_files()
  require('telescope.builtin').find_files {
    prompt_title = 'Chezmoi files',
    cwd = os.getenv 'HOME' .. '/.local/share/chezmoi',
  }
end

-- Find directories from project's root cwd
function M.find_dirs()
  local actions = require 'plugins.telescope.actions'

  M.find_files {
    prompt_title = 'Find Directories',
    find_command = { 'fd', '--type', 'directory', '--hidden', '--exclude', '**/.git/*' },
    attach_mappings = function(_, map)
      map('i', '<CR>', actions.reveal_in_nvim_tree)
      return true
    end,
  }
end

-- Fuzzy search within buffer
function M.local_fuzzy_find()
  local opts = require('telescope.themes').get_dropdown {
    winblend = 10,
    previewer = false,
  }

  require('telescope.builtin').current_buffer_fuzzy_find(opts)
end

-- Search text within workspace using grep_string instead of live_grep
-- since it doesn't support fuzzy finding
-- ref: https://www.reddit.com/r/neovim/comments/s696vk/telescope_fzf_ag_for_live_grep/
function M.workspace_fuzzy_find(opts)
  opts = opts or {}

  opts.prompt_title = opts.prompt_title or 'Search current workspace'
  opts.search = opts.search or ''
  opts.only_sort_text = opts.only_sort_text or true

  require('telescope.builtin').grep_string(opts)
end

-- Fuzzy search help pages
function M.helpgrep(opts)
  opts = opts or {}

  opts.disable_coordinates = false
  opts.path_display = { 'tail' }
  opts.additional_args = { '--iglob', '!**/tags', '--iglob', '**/*.{txt,md}' }

  M.workspace_fuzzy_find(opts)
end

return M
