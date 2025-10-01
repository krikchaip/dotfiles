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
  Serialize = function()
    return vim
      .iter(vim.api.nvim_list_tabpages())
      :map(function(tab)
        return vim
          .iter(vim.t[tab].bufs)
          :map(function(buf)
            return vim.api.nvim_buf_get_name(buf)
          end)
          :filter(function(bufname)
            return #bufname > 0
          end)
          :totable()
      end)
      :totable()
  end,
  Load = function(tabpages)
    local bufs = vim
      .iter(vim.api.nvim_list_tabpages())
      :map(function(t)
        return vim.t[t].bufs
      end)
      :flatten()
      :fold({}, function(acc, b)
        acc[vim.api.nvim_buf_get_name(b)] = b
        return acc
      end)

    for t, tab_bufs in ipairs(tabpages) do
      vim.t[t].bufs = vim
        .iter(tab_bufs)
        :map(function(name)
          return bufs[name]
        end)
        :totable()
    end
  end,
}

ScrollPosition = {
  Serialize = function()
    if not vim.w.SavedBufView then return {} end

    local bufs = vim
      .iter(vim.api.nvim_list_tabpages())
      :map(function(tab)
        return vim.t[tab].bufs
      end)
      :flatten()
      :fold({}, function(acc, buf)
        acc[buf] = true
        return acc
      end)

    local views = vim.tbl_extend("force", vim.w.SavedBufView, {
      [tostring(vim.api.nvim_get_current_buf())] = vim.fn.winsaveview(),
    })

    return vim
      .iter(views)
      :filter(function(b)
        return bufs[tonumber(b, 10)]
      end)
      :fold({}, function(acc, b, view)
        acc[vim.api.nvim_buf_get_name(tonumber(b, 10))] = view
        return acc
      end)
  end,
  Load = function(data)
    local bufs = vim
      .iter(vim.api.nvim_list_tabpages())
      :map(function(t)
        return vim.t[t].bufs
      end)
      :flatten()
      :fold({}, function(acc, b)
        acc[vim.api.nvim_buf_get_name(b)] = b
        return acc
      end)

    vim.w.SavedBufView = vim.iter(data):fold({}, function(acc, name, view)
      acc[tostring(bufs[name])] = view
      return acc
    end)
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
  SearchNode = function()
    require("configs.telescope").search_node()
  end,
}

Treesitter = {
  Upwards = function()
    require("treesitter-context").go_to_context(vim.v.count1)
  end,
}

LSP = {
  Hover = function()
    vim.lsp.buf.hover { silent = true, border = "single", max_width = 80 }
  end,
  Definition = function()
    require("goto-preview").goto_preview_definition {}
  end,
  Declaration = function()
    require("goto-preview").goto_preview_declaration {}
  end,
  Implementation = function()
    require("goto-preview").goto_preview_implementation {}
  end,
  Typedef = function()
    require("goto-preview").goto_preview_type_definition {}
  end,
  References = function()
    vim.cmd "Telescope lsp_references"
  end,
  DocumentSymbols = function()
    vim.cmd "Outline"
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
    vim.lsp.buf.signature_help { silent = true, max_height = 7, max_width = 80, border = "single" }
  end,
  NextWord = function()
    Snacks.words.jump(1, true)
  end,
  PreviousWord = function()
    Snacks.words.jump(-1, true)
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
    require("nvim-tree.api").tree.open { find_file = vim.g.auto_reveal_buffer }
  end,
  Toggle = function()
    require("nvim-tree.api").tree.toggle { find_file = vim.g.auto_reveal_buffer, focus = false }
  end,
  Reveal = function()
    require("nvim-tree.api").tree.open { find_file = true }
  end,
  RevealToggle = function()
    vim.g.auto_reveal_buffer = not vim.g.auto_reveal_buffer
    if vim.g.auto_reveal_buffer then require("nvim-tree.api").tree.find_file() end
    vim.notify(string.format("auto_reveal_buffer: %s", vim.g.auto_reveal_buffer))
  end,
  Mini = function()
    require("configs.mini.files").open()
  end,
  MiniReveal = function()
    require("configs.mini.files").open_reveal()
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
    local filename = vim.fn.expand "%:p"
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

Session = {
  Load = function()
    local notify = vim.notify
    vim.notify = function(msg, level)
      local match_msg = msg:find "Cannot find last loaded cwd session" ~= nil
      local match_level = level == vim.log.levels.ERROR

      if match_msg and match_level then
        vim.cmd "enew"
      else
        notify(msg, level)
      end

      vim.notify = notify
    end

    vim.cmd "PossessionLoadCwd"
  end,
}

Notification = {
  Show = function()
    Snacks.notifier.show_history()
  end,
}

UFO = {
  PrevRegion = function()
    require("ufo").goPreviousClosedFold()
  end,
  NextRegion = function()
    require("ufo").goNextClosedFold()
  end,
}

Markdown = {
  TogglePreview = function()
    require("render-markdown").buf_toggle()
  end,
}

GrugFar = {
  Toggle = function(opts)
    opts = vim.tbl_deep_extend("force", { instanceName = "GrugFar" }, opts)
    require("grug-far").toggle_instance(opts)
  end,
  Buffer = function()
    GrugFar.Toggle { prefills = { paths = vim.fn.expand "%" } }
  end,
  Workspace = function()
    GrugFar.Toggle {}
  end,
  Selection = function()
    GrugFar.Toggle { visualSelectionUsage = "operate-within-range" }
  end,
}

LLM = {
  ToggleChat = function()
    require("codecompanion").toggle()
  end,
  Inline = function()
    return ":CodeCompanion "
  end,
  Actions = function()
    require("codecompanion").actions {}
  end,
}
