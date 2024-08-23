-- Vimscript utilities
vim.cmd [[
  " Escape Vim regexp characters
  " ref: https://stackoverflow.com/questions/11311431/how-to-escape-search-patterns-or-regular-expressions-in-vimscript
  function! EscapeVimRegexp(str)
    return escape(a:str, '^$.*?/\[]~')
  endfunction
]]

--- Combine multiple table lists together.
--- @generic T
--- @param ... T[] table lists
--- @return T[] combined_list { ...ListA, ...ListB, ... }
function list_concat(...)
  return vim.iter({ ... }):flatten():totable()
end

-- How to close all invisible buffers
-- ref: https://www.reddit.com/r/neovim/comments/158it1i/how_to_close_all_invisible_buffers
function delete_hidden_buffers()
  local bufinfos = vim.fn.getbufinfo { buflisted = 1 }

  vim.tbl_map(function(bufinfo)
    local unmodified = bufinfo.changed == 0
    local no_windows = not bufinfo.windows or #bufinfo.windows == 0

    if unmodified and no_windows then vim.api.nvim_buf_delete(bufinfo.bufnr, { force = false, unload = false }) end
  end, bufinfos)
end

--- @param tabpage? integer
function tabpage_list_normal_wins(tabpage)
  tabpage = tabpage or 0

  local winids = vim.api.nvim_tabpage_list_wins(tabpage)

  return vim.tbl_filter(function(id)
    -- excludes floating window
    return vim.api.nvim_win_get_config(id).relative == ''
  end, winids)
end

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

--- @param path string? target path. default to `cwd`
--- @return string branch current branch name
function get_git_current_branch(path)
  local cmd = { 'git', 'branch', '--show-current' }
  local opts = path and { cwd = path, text = true } or { text = true }

  local result = vim.system(cmd, opts):wait()

  if result.code ~= 0 then vim.notify(result.stderr, vim.log.levels.ERROR) end
  return result.stdout
end

--- Smart delete current buffer
--- Window:  switch to the last accessed when there's more than one
--- Tabpage: switch to the last accessed when there're no more windows left
---
--- @param bang? boolean default `false`
function smart_delete_buffer(bang)
  bang = bang or false

  --- @param bufnr? number default current buffer
  --- @param winnr? number default current window
  return function(bufnr, winnr)
    local last_buf = bufnr or vim.api.nvim_get_current_buf()
    local last_win = winnr or vim.api.nvim_get_current_win()

    -- close loclist window if present
    vim.cmd [[lclose]]

    if #vim.api.nvim_tabpage_list_wins(0) > 1 then
      vim.cmd.wincmd 'p'
    else
      local has_last_tab, _ = pcall(vim.cmd, 'tabnext#')
      if not has_last_tab then pcall(vim.cmd, 'tabnext-') end
    end

    if #vim.fn.win_findbuf(last_buf) > 1 then
      vim.api.nvim_win_close(last_win, false)
    else
      vim.cmd.bdelete { last_buf, bang = bang }
    end
  end
end

-- Smart tabpage closer.
-- Will return to previously active tabpage when possible
function smart_close_tabpage()
  local tabnr = vim.fn.tabpagenr()

  local has_last_tab, _ = pcall(vim.cmd, 'tabnext#')
  if not has_last_tab then pcall(vim.cmd, 'tabnext-') end

  pcall(vim.cmd.tabclose, { tabnr })
  delete_hidden_buffers()
end

-- Smart window/tabpage switcher.
-- TODO: utilize histories stack and 2 pointers (curr / prev). pops the stack
--       when either pointer becomes unreachable.
function smart_switch_window()
  vim.cmd [[wincmd p]]
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
