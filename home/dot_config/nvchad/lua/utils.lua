vim.cmd [[
  " escape Vim regexp characters
  " ref: https://stackoverflow.com/questions/11311431/how-to-escape-search-patterns-or-regular-expressions-in-vimscript
  function! EscapeVimRegexp(str)
    return escape(a:str, '^$.*?/\[]~')
  endfunction
]]

function MacroStartStop()
  if vim.fn.reg_recording() ~= "" then
    -- if still recording, then stop
    return "q"
  else
    -- otherwise, start new recording
    return "qq"
  end
end
