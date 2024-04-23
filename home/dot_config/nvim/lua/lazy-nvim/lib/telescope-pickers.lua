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

function M.local_fuzzy_find()
  local opts = require('telescope.themes').get_dropdown {
    winblend = 10,
    previewer = false,
  }

  require('telescope.builtin').current_buffer_fuzzy_find(opts)
end

return M
