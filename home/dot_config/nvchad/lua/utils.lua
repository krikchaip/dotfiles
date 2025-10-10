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

---@param block? boolean
function GetLastVisualSelection(block)
  local start_pos = vim.fn.getpos "'<"
  local end_pos = vim.fn.getpos "'>"

  local start_line, end_line = start_pos[2], end_pos[2]
  local start_col, end_col = start_pos[3], end_pos[3]
  local line_range = { ["start"] = start_line, ["end"] = end_line }

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  if #lines == 0 then return "", line_range end

  -- Single line selection
  if start_line == end_line then return string.sub(lines[1], start_col, end_col), line_range end

  local selected_text = ""

  -- Multi-line selection
  if block then
    selected_text = string.sub(lines[1], start_col, end_col) .. "\n"
  else
    selected_text = string.sub(lines[1], start_col) .. "\n"
  end

  for i = 2, #lines - 1 do
    local line = block and string.sub(lines[i], start_col, end_col) or lines[i]
    selected_text = selected_text .. line .. "\n"
  end

  if block then
    selected_text = selected_text .. string.sub(lines[#lines], start_col, end_col)
  else
    selected_text = selected_text .. string.sub(lines[#lines], 1, end_col)
  end

  return selected_text, line_range
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
    local tabpages = vim.api.nvim_list_tabpages()
    if #tabpages == 1 then return pcall(require("nvchad.tabufline").close_buffer) end

    local curr_tab = vim.api.nvim_get_current_tabpage()
    local curr_buf = vim.api.nvim_get_current_buf()

    local other_tabs = vim.iter(tabpages):filter(function(tab)
      return tab ~= curr_tab
    end)

    local buf_exists = other_tabs:any(function(tab)
      return vim.tbl_contains(vim.t[tab].bufs, curr_buf)
    end)

    if not buf_exists then return pcall(require("nvchad.tabufline").close_buffer) end

    vim.o.lazyredraw = true

    vim.t.bufs = vim
      .iter(vim.t.bufs)
      :filter(function(buf)
        return buf ~= curr_buf
      end)
      :totable()

    if #vim.t.bufs > 0 then
      local next_buf_nr = vim.t.bufs[#vim.t.bufs]
      local wins = vim.api.nvim_tabpage_list_wins(curr_tab)

      for _, win in ipairs(wins) do
        if vim.api.nvim_win_get_buf(win) == curr_buf then vim.api.nvim_win_set_buf(win, next_buf_nr) end
      end
    else
      vim.cmd "enew"
    end

    vim.o.lazyredraw = false
    vim.cmd "redraw!"
  end,
  CloseAll = function()
    require("nvchad.tabufline").closeAllBufs(true)
  end,
  BreakTab = function()
    if #vim.t.bufs <= 1 then return end

    local bufnr = vim.api.nvim_get_current_buf()
    local old_tab = vim.api.nvim_get_current_tabpage()

    vim.cmd("tab sb " .. bufnr)

    local new_tab = vim.api.nvim_get_current_tabpage()

    vim.o.lazyredraw = true
    vim.api.nvim_set_current_tabpage(old_tab)

    vim.t.bufs = vim
      .iter(vim.t.bufs)
      :filter(function(b)
        return b ~= bufnr
      end)
      :totable()

    if #vim.t.bufs > 0 then
      local next_buf_nr = vim.t.bufs[#vim.t.bufs]
      local wins = vim.api.nvim_tabpage_list_wins(old_tab)

      for _, win in ipairs(wins) do
        if vim.api.nvim_win_get_buf(win) == bufnr then vim.api.nvim_win_set_buf(win, next_buf_nr) end
      end
    else
      vim.cmd "enew"
    end

    vim.api.nvim_set_current_tabpage(new_tab)
    vim.o.lazyredraw = false

    vim.cmd "redraw!"
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
      :filter(function(tab)
        return #tab > 0
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
        local bufid = tonumber(b, 10)
        if not bufs[bufid] then return false end

        local bufname = vim.api.nvim_buf_get_name(bufid)
        if #bufname < 1 then return false end

        local buftype = vim.api.nvim_get_option_value("buftype", { buf = bufid })
        if buftype == "nofile" then return false end

        return true
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

    if next(data) == nil then
      vim.w.SavedBufView = nil
      return
    end

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
  FormatBuf = function(bufnr)
    require("conform").format { async = false, bufnr = bufnr }
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
    return ":CodeCompanion #{buffer} "
  end,
  Actions = function()
    require("codecompanion").actions {}
  end,
}

Clipboard = {
  ---@diagnostic disable: param-type-mismatch
  YankRelative = function(modifier)
    modifier = modifier or "%"

    local raw_path = vim.fn.expand(modifier)
    if #raw_path == 0 then return end

    local relative_path = require("plenary.path").new(raw_path):make_relative()

    vim.fn.setreg("+", relative_path)
    vim.notify("Copied relative path: " .. relative_path)
  end,
  YankAbsolute = function(modifier)
    modifier = modifier or "%"

    local absolute_path = vim.fn.expand(modifier .. ":p")
    if #absolute_path == 0 then return end

    vim.fn.setreg("+", absolute_path)
    vim.notify("Copied absolute path: " .. absolute_path)
  end,
  YankRegionWithContext = function()
    local mode = vim.fn.mode()
    local visual_modes = { "v", "V", "" }

    if not vim.tbl_contains(visual_modes, mode) then return vim.notify("Not in visual mode", vim.log.levels.WARN) end

    local block = mode == ""
    local esc = vim.api.nvim_replace_termcodes("<Esc>", true, false, true)

    vim.api.nvim_feedkeys(esc, "x", false)

    local content, range = GetLastVisualSelection(block)

    if #content == 0 then return end

    local raw_path = vim.fn.expand "%"
    if #raw_path == 0 then return end

    local relative_path = require("plenary.path").new(raw_path):make_relative()

    local line_range = ""
    if range["start"] == range["end"] then
      line_range = string.format("line %d", range["start"])
    else
      line_range = string.format("lines %d-%d", range["start"], range["end"])
    end

    local context = ""
      .. string.format("From the following code snippet (%s) in the file %s\n\n", line_range, relative_path)
      .. string.format("```\n%s\n```\n\n", content)

    vim.fn.setreg("+", context)
    vim.notify "Copied region with context to clipboard"
  end,
  PasteRelative = function()
    local modifier = #vim.bo.buftype > 0 and "#" or nil
    Clipboard.YankRelative(modifier)
    vim.cmd [[normal "+gp]]
  end,
  PasteAbsolute = function()
    local modifier = #vim.bo.buftype > 0 and "#" or nil
    Clipboard.YankAbsolute(modifier)
    vim.cmd [[normal "+gp]]
  end,
  PasteImage = function()
    vim.cmd "PasteImage"
  end,
}
