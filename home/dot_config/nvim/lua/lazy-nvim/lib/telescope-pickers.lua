local M = {}

-- Live grep from project git root with fallback
-- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#live-grep-from-project-git-root-with-fallback
function M.live_grep(opts)
  opts = opts or {}

  if is_git_repo() then
    opts.cwd = get_git_root()
  end

  require('telescope.builtin').live_grep(opts)
end

-- Find files from project git root with fallback
-- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#find-files-from-project-git-root-with-fallback
function M.find_files(opts)
  opts = opts or {}

  if is_git_repo() then
    opts.cwd = get_git_root()
  end

  require('telescope.builtin').find_files(opts)
end

function M.find_chezmoi_files()
  -- NOTE: this is somehow doesn't work
  -- telescope.extensions.chezmoi.find_files {}

  require('telescope.builtin').find_files {
    prompt_title = 'Chezmoi files',
    cwd = os.getenv('HOME') .. '/.local/share/chezmoi'
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

-- Search text within workspace using grep_string
function M.workspace_fuzzy_find()
  -- Live grep does not support fuzzy finding
  -- ref: https://www.reddit.com/r/neovim/comments/s696vk/telescope_fzf_ag_for_live_grep/
  require('telescope.builtin').grep_string {
    prompt_title = 'Search current workspace',
    search = '',
    only_sort_text = true
  }
end

function M.search_session()
  require('auto-session.session-lens').search_session()
end

return M
