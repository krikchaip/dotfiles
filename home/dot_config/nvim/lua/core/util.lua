---@diagnostic disable: lowercase-global, param-type-mismatch

-- Global Vim utility functions
vim.cmd [[
  " Escape Vim regexp characters
  " ref: https://stackoverflow.com/questions/11311431/how-to-escape-search-patterns-or-regular-expressions-in-vimscript
  function! EscapeVimRegexp(str)
    return escape(a:str, '^$.*?/\[]~')
  endfunction
]]

function is_git_repo()
  vim.fn.system 'git rev-parse --is-inside-work-tree'
  return vim.v.shell_error == 0
end

function is_git_file()
  --  % -> current buffer filename
  -- :h -> get the head part from the path
  -- ref: https://stackoverflow.com/questions/69050359/how-to-get-the-current-buffer-file-path-using-the-neovim-lua-api#:~:text=You%20can%20access%20the%20full,means%20%22the%20current%20buffer%22.&text=%25%20is%20expanded%20to%20the%20current%20filename.
  local folder_path = vim.fn.expand '%:h'

  -- check if directory is git repository without having to cd into it
  -- ref: https://stackoverflow.com/questions/39518124/check-if-directory-is-git-repository-without-having-to-cd-into-it
  vim.fn.system('git -C "' .. folder_path .. '" rev-parse --is-inside-work-tree')

  return vim.v.shell_error == 0
end

function get_git_root()
  local dot_git_path = vim.fn.finddir('.git', '.;')
  return vim.fn.fnamemodify(dot_git_path, ':h')
end

-- Smart delete current buffer
-- Window:  switch to the last accessed when there's more than one
-- Tabpage: switch to the last accessed when there're no more windows left
function smart_delete_buffer(bang)
  bang = bang or false

  return function()
    local last_buf = tostring(vim.api.nvim_get_current_buf())

    if #vim.api.nvim_tabpage_list_wins(0) > 1 then
      vim.cmd.wincmd 'p'
    else
      vim.cmd [[silent! tabnext #]]
    end

    vim.cmd.bdelete { last_buf, bang = bang }
  end
end

-- Smart tabpage closer.
-- Will return to previously active tabpage when possible
function smart_close_tabpage()
  local ok, _ = pcall(vim.cmd, 'tabnext# | tabclose#')
  if not ok then vim.cmd [[tabclose]] end
end

function macro_start_stop()
  if vim.fn.reg_recording() ~= '' then
    -- if still recording, then stop
    return 'q'
  else
    -- otherwise, start new recording
    return 'qq'
  end
end
