local M = {}

local function is_git_repo()
  vim.fn.system('git rev-parse --is-inside-work-tree')
  return vim.v.shell_error == 0
end

local function get_git_root()
  local dot_git_path = vim.fn.finddir('.git', '.;')
  return vim.fn.fnamemodify(dot_git_path, ':h')
end

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
