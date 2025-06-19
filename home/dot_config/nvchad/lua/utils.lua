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
    vim.cmd "lua require('goto-preview').goto_preview_definition()"
  end,
  Declaration = function()
    vim.cmd "lua require('goto-preview').goto_preview_declaration()"
  end,
  Implementation = function()
    vim.cmd "lua require('goto-preview').goto_preview_implementation()"
  end,
  Typedef = function()
    vim.cmd "lua require('goto-preview').goto_preview_type_definition()"
  end,
  Rename = function()
    require "nvchad.lsp.renamer"()
  end,
  References = function()
    vim.cmd "Telescope lsp_references include_declaration=false"
  end,
  WorkspaceSymbols = function()
    vim.cmd "Telescope lsp_dynamic_workspace_symbols"
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

Diagnostic = {
  Buffer = function()
    require("telescope.builtin").diagnostics(require("telescope.themes").get_ivy { bufnr = 0 })
  end,
  Workspace = function()
    require("telescope.builtin").diagnostics(require("telescope.themes").get_ivy {})
  end,
}

Conform = {
  Format = function()
    require("conform").format { async = true }
  end,
  FormatSave = function()
    require("conform").format({ async = false }, function(err, _)
      if err then vim.notify_once(err, vim.log.levels.ERROR) end
      vim.cmd "silent write"
    end)
  end,
}

Explorer = {
  Open = function()
    require("nvim-tree.api").tree.open { find_file = vim.g.auto_reveal }
  end,
  Toggle = function()
    require("nvim-tree.api").tree.toggle { find_file = vim.g.auto_reveal, focus = false }
  end,
  Reveal = function()
    require("nvim-tree.api").tree.open { find_file = true }
  end,
  RevealToggle = function()
    vim.g.auto_reveal = not vim.g.auto_reveal
    if vim.g.auto_reveal then require("nvim-tree.api").tree.find_file() end
    vim.notify(string.format("auto_reveal: %s", vim.g.auto_reveal))
  end,
}

Git = {
  FloatOpts = function(opts)
    local base_opts = { pos = "float", float_opts = { width = 0.8, height = 0.8, row = 0.05, col = 0.1 } }
    return vim.tbl_deep_extend("force", base_opts, opts)
  end,
  Status = function()
    require("nvchad.term").toggle(Git.FloatOpts { id = "git.status", cmd = "lazygit" })
  end,
}
