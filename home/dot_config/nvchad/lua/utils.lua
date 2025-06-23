vim.cmd [[
  " escape Vim regexp characters
  " ref: https://stackoverflow.com/questions/11311431/how-to-escape-search-patterns-or-regular-expressions-in-vimscript
  function! EscapeVimRegexp(str)
    return escape(a:str, '^$.*?/\[]~')
  endfunction
]]

---@return string expr
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
    pcall(require("nvchad.tabufline").close_buffer)
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
  Grep = function()
    require("configs.telescope").grep()
  end,
  Dotfiles = function()
    require("configs.telescope").dotfiles()
  end,
}

LSP = {
  Hover = function()
    vim.lsp.buf.hover { silent = true, border = "single", max_width = 90 }
  end,
  Definition = function()
    vim.schedule(require("goto-preview").goto_preview_definition)
  end,
  Declaration = function()
    vim.schedule(require("goto-preview").goto_preview_declaration)
  end,
  Implementation = function()
    vim.schedule(require("goto-preview").goto_preview_implementation)
  end,
  Typedef = function()
    vim.schedule(require("goto-preview").goto_preview_type_definition)
  end,
  Rename = function()
    require "nvchad.lsp.renamer"()
  end,
  References = function()
    vim.cmd "Telescope lsp_references"
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
    require("telescope.builtin").diagnostics(require("telescope.themes").get_ivy { no_unlisted = true })
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
  Mini = function()
    require("configs.mini.files").open()
  end,
  MiniRoot = function()
    require("configs.mini.files").open_root()
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
  Log = function()
    require("nvchad.term").toggle(Git.FloatOpts { id = "git.log", cmd = "lazygit log" })
  end,
  Branch = function()
    require("nvchad.term").toggle(Git.FloatOpts { id = "git.branch", cmd = "lazygit branch" })
  end,
  FileHistory = function()
    local filename = vim.fn.expand "%"
    local cmd = table.concat({ "lazygit", "-f", filename }, " ")
    require("nvchad.term").new(Git.FloatOpts { id = "git.file-history", cmd = cmd })
  end,
  BlameLine = function()
    require("gitsigns").blame_line { full = true }
  end,
  StageHunk = function()
    require("gitsigns").stage_hunk()
  end,
  StageHunkV = function()
    require("gitsigns").stage_hunk { vim.fn.line ".", vim.fn.line "v" }
  end,
  StageHunkAll = function()
    require("gitsigns").stage_buffer()
  end,
  ResetHunk = function()
    require("gitsigns").reset_hunk()
  end,
  ResetHunkV = function()
    require("gitsigns").reset_hunk { vim.fn.line ".", vim.fn.line "v" }
  end,
  ResetHunkAll = function()
    require("gitsigns").reset_buffer()
  end,
  Unstage = function()
    require("gitsigns").reset_buffer_index()
  end,
  NavHunk = function(direction, diffkey)
    return function()
      if vim.wo.diff then
        vim.cmd.normal { diffkey, bang = true }
      else
        require("gitsigns").nav_hunk(direction, { preview = false })
      end
    end
  end,

  ---@param paths string[]
  ---@return table<string, boolean> ignored
  CheckIgnore = function(paths)
    local command = { "git", "check-ignore", "--stdin" }
    local stdin = table.concat(paths, "\n")
    local output = {}

    local process = vim.fn.jobstart(command, {
      stdout_buffered = true,
      on_stdout = function(_, data)
        for _, line in ipairs(data) do
          if #line > 0 then output[line] = true end
        end
      end,
    })

    -- command failed to run
    if process < 1 then return {} end

    -- send paths via STDIN
    vim.fn.chansend(process, stdin)
    vim.fn.chanclose(process, "stdin")
    vim.fn.jobwait { process }

    return output
  end,
}

Notification = {
  Show = function()
    Snacks.notifier.show_history()
  end,
}
