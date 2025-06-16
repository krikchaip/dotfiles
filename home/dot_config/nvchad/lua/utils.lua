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

LSP = {
  Hover = function()
    vim.lsp.buf.hover { silent = true, border = "single", max_width = 90 }
  end,
  Definition = function()
    vim.lsp.buf.definition()
  end,
  Declaration = function()
    vim.lsp.buf.declaration()
  end,
  Typedef = function()
    vim.lsp.buf.type_definition()
  end,
  Rename = function()
    require "nvchad.lsp.renamer"()
  end,
  WorkspaceAdd = function()
    vim.lsp.buf.add_workspace_folder()
  end,
  WorkspaceRemove = function()
    vim.lsp.buf.remove_workspace_folder()
  end,
  WorkspaceList = function()
    print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
  end,
  Signature = function()
    -- ref: https://github.com/NvChad/ui/blob/v3.0/lua/nvchad/lsp/signature.lua#L28
    vim.lsp.buf.signature_help { silent = true, max_height = 7, border = "single" }
  end,
}
