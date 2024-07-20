-- Vimscript utilities
vim.cmd [[
  " Escape Vim regexp characters
  " ref: https://stackoverflow.com/questions/11311431/how-to-escape-search-patterns-or-regular-expressions-in-vimscript
  function! EscapeVimRegexp(str)
    return escape(a:str, '^$.*?/\[]~')
  endfunction
]]

function macro_start_stop()
  if vim.fn.reg_recording() ~= '' then
    -- if still recording, then stop
    return 'q'
  else
    -- otherwise, start new recording
    return 'qq'
  end
end

--- Combine multiple table lists together.
--- @generic T
--- @param ... T[] table lists
--- @return T[] combined_list { ...ListA, ...ListB, ... }
function list_concat(...)
  return vim.iter({ ... }):flatten():totable()
end
