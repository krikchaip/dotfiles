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

NvChad = {
  Cheatsheet = function()
    vim.cmd "NvCheatsheet"
  end,
  Themes = function()
    require("nvchad.themes").open()
  end,
}

Tabufline = {
  Next = function()
    require("nvchad.tabufline").next()
  end,
  Prev = function()
    require("nvchad.tabufline").prev()
  end,
  MoveRight = function()
    require("nvchad.tabufline").move_buf(1)
  end,
  MoveLeft = function()
    require("nvchad.tabufline").move_buf(-1)
  end,
  Close = function()
    local ok = pcall(require("nvchad.tabufline").close_buffer)
    if not ok then vim.cmd "bd" end
  end,
  CloseAll = function()
    require("nvchad.tabufline").closeAllBufs(true)
  end,
}

Term = {
  VSplit = function()
    require("nvchad.term").new { pos = "vsp" }
  end,
  HSplit = function()
    require("nvchad.term").new { pos = "sp" }
  end,
  VToggle = function()
    require("nvchad.term").toggle { pos = "vsp", id = "vtoggleTerm" }
  end,
  HToggle = function()
    require("nvchad.term").toggle { pos = "sp", id = "htoggleTerm" }
  end,
  Toggle = function()
    require("nvchad.term").toggle { pos = "float", id = "floatTerm" }
  end,
}

Telescope = {
  Dotfiles = function()
    vim.cmd "Telescope find_files prompt_title=Dotfiles cwd=~/.local/share/chezmoi"
  end,
}
