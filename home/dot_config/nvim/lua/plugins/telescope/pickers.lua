local M = {}

-- Find files from project's root cwd
function M.find_files(opts)
  opts = opts or {}

  opts.cwd = vim.loop.cwd()

  require('telescope.builtin').find_files(opts)
end

-- Find chezmoi files using `find_files` instead since its extension does not work somehow
function M.find_chezmoi_files()
  require('telescope.builtin').find_files {
    prompt_title = 'Chezmoi files',
    cwd = os.getenv 'HOME' .. '/.local/share/chezmoi',
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
function M.workspace_fuzzy_find()
  require('telescope.builtin').grep_string {
    prompt_title = 'Search current workspace',
    search = '',
    only_sort_text = true,
  }
end

return M
