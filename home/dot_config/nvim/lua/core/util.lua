---@diagnostic disable: lowercase-global

function is_git_repo()
  vim.fn.system('git rev-parse --is-inside-work-tree')
  return vim.v.shell_error == 0
end

function is_git_file()
  --  % -> current buffer filename
  -- :h -> get the head part from the path
  -- ref: https://stackoverflow.com/questions/69050359/how-to-get-the-current-buffer-file-path-using-the-neovim-lua-api#:~:text=You%20can%20access%20the%20full,means%20%22the%20current%20buffer%22.&text=%25%20is%20expanded%20to%20the%20current%20filename.
  local folder_path = vim.fn.expand('%:h')

  -- check if directory is git repository without having to cd into it
  -- ref: https://stackoverflow.com/questions/39518124/check-if-directory-is-git-repository-without-having-to-cd-into-it
  vim.fn.system('git -C "' .. folder_path .. '" rev-parse --is-inside-work-tree')

  return vim.v.shell_error == 0
end

function get_git_root()
  local dot_git_path = vim.fn.finddir('.git', '.;')
  return vim.fn.fnamemodify(dot_git_path, ':h')
end
