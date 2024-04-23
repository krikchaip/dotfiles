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

return M
