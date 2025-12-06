local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
  opts = opts or { defaults = {} }

  opts.defaults.vimgrep_arguments = M.vimgrep_arguments()

  opts.defaults.preview = {
    mime_hook = function(filepath, bufnr, options)
      if Snacks.image.supports(filepath) then
        Snacks.image.buf.attach(bufnr, { src = filepath, inline = true })
      else
        require("telescope.previewers").buffer_previewer_maker(filepath, bufnr, options)
      end
    end,
  }

  opts.defaults.mappings = {
    i = {
      -- close prompt
      ["<C-c>"] = false,
      ["<C-q>"] = "close",
      ["<ESC>"] = "close",

      -- scrolling
      ["<PageDown>"] = false,
      ["<PageUp>"] = false,
      ["<M-d>"] = "results_scrolling_down",
      ["<M-u>"] = "results_scrolling_up",

      -- item selection (qflist)
      ["<M-Tab>"] = "drop_all",
    },
  }

  opts.pickers = {
    -- `hidden = true` will still show the inside of `.git/` as it's not specified in `.gitignore`.
    -- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
    find_files = {
      find_command = { "fd", "--type", "file", "--hidden", "--exclude", "**/.git/*" },
    },

    grep_string = {
      mappings = {
        i = {
          ["<M-s>"] = M.scope_search,
        },
      },
    },

    live_grep = {
      mappings = {
        i = {
          ["<M-s>"] = M.scope_search,
        },
      },
    },

    buffers = {
      select_current = true,
      path_display = { "filename_first" },
      mappings = {
        i = {
          ["<M-d>"] = false,
          ["<C-c>"] = "delete_buffer",
        },
      },
    },

    lsp_references = {
      include_declaration = false,
      include_current_line = false,
    },
  }

  return opts
end

M.setup = function(opts)
  require("telescope").setup(M.config(opts))

  -- configure the `vim_buffer_` previewer
  -- ref: https://github.com/nvim-telescope/telescope.nvim#previewers
  autocmd("User", {
    desc = "Set Vim options for Telescope previewer",
    group = augroup("telescope-previewer", { clear = true }),
    pattern = "TelescopePreviewerLoaded",
    callback = function(args)
      vim.wo.number = true

      local no_numbers = {
        help = true,
        netrw = true,
      }

      local filetype = args.data.filetype
      local bufname = args.data.bufname

      if filetype and no_numbers[filetype] then vim.wo.number = false end
      if bufname and Snacks.image.supports(bufname) then vim.wo.number = false end
      if bufname and bufname:match "*.csv" then vim.wo.wrap = false end
    end,
  })
end

-- file and text search in hidden files and directories
-- ref: https://github.com/nvim-telescope/telescope.nvim/wiki/Configuration-Recipes#file-and-text-search-in-hidden-files-and-directories
M.vimgrep_arguments = function()
  local args = require("telescope.config").values.vimgrep_arguments

  table.insert(args, "--hidden")

  table.insert(args, "--glob")
  table.insert(args, "!**/.git/*")

  table.insert(args, "--glob")
  table.insert(args, "!**/pnpm-lock.yaml")

  table.insert(args, "--glob")
  table.insert(args, "!**/yarn.lock")

  table.insert(args, "--glob")
  table.insert(args, "!**/package-lock.json")

  table.insert(args, "--glob")
  table.insert(args, "!**/*.pdf")

  return args
end

M.grep = function(opts)
  opts = opts or {}

  opts.prompt_title = opts.prompt_title or "Grep"
  opts.search = opts.search or ""
  opts.only_sort_text = true

  require("telescope.builtin").live_grep(opts)
end

M.dotfiles = function(opts)
  opts = opts or {}

  opts.prompt_title = opts.prompt_title or "Dotfiles"
  opts.cwd = "~/.local/share/chezmoi"

  require("telescope.builtin").find_files(opts)
end

M.search_node = function(opts)
  opts = opts or {}

  local find_command = M.config().pickers.find_files.find_command

  table.insert(find_command, "--type")
  table.insert(find_command, "directory")

  opts.prompt_title = opts.prompt_title or "Search Node"
  opts.cwd = opts.cwd or vim.uv.cwd()
  opts.find_command = opts.find_command or find_command
  opts.history = opts.history or {}
  opts.default_text = opts.default_text or ""
  opts.previewer = require("telescope.config").values.file_previewer(opts)

  local function select_default(prompt_bufnr)
    local selection = require("telescope.actions.state").get_selected_entry()
    if not selection then return end

    local filename = selection.value or selection.filename or selection[1]
    local filepath = vim.fs.joinpath(selection.cwd, filename)

    if vim.uv.fs_stat(filepath).type == "file" then
      require("telescope.actions").select_default(prompt_bufnr)
      return
    end

    local picker = require("telescope.actions.state").get_current_picker(prompt_bufnr)
    local prompt_input = require("telescope.actions.state").get_current_line()

    require("telescope.actions").close(prompt_bufnr)

    local entries = vim
      .iter(picker.finder.results)
      :map(function(result)
        return result[1]
      end)
      :totable()

    table.insert(opts.history, {
      cwd = opts.cwd,
      input = prompt_input,
      entries = entries,
      selection_index = picker._selection_row + 1,
    })

    M.search_node {
      prompt_title = string.format("Search Node (%s)", filename),
      cwd = filepath,
      history = opts.history,
    }
  end

  local function go_back(prompt_bufnr)
    if #opts.history == 0 then return end

    require("telescope.actions").close(prompt_bufnr)

    local last = table.remove(opts.history)
    local prompt_title = "Search Node"

    if last.cwd ~= vim.uv.cwd() then
      local relative_path = require("plenary.path").new(last.cwd):make_relative()
      prompt_title = prompt_title .. string.format(" (%s)", relative_path)
    end

    M.search_node {
      prompt_title = prompt_title,
      history = opts.history,
      cwd = last.cwd,
      default_text = last.input,
      entries = last.entries,
      selection_index = last.selection_index,
    }
  end

  local attach_mappings = opts.attach_mappings
  opts.attach_mappings = function(_, map)
    map("i", "<CR>", select_default)
    map("i", "<S-BS>", go_back)

    if attach_mappings then
      return attach_mappings(_, map)
    else
      return true
    end
  end

  -- after pressing go_back
  if opts.entries and opts.selection_index then
    local pickers = require "telescope.pickers"
    local finders = require "telescope.finders"
    local make_entry = require "telescope.make_entry"
    local conf = require("telescope.config").values

    pickers
      .new(opts, {
        finder = finders.new_table {
          results = opts.entries,
          entry_maker = make_entry.gen_from_file(opts),
        },
        previewer = conf.file_previewer(opts),
        sorter = conf.file_sorter(opts),
        default_selection_index = opts.selection_index,
      })
      :find()

    return
  end

  require("telescope.builtin").find_files(opts)
end

M.tab_buffers = function(opts)
  opts = opts or {}

  local bufnrs = vim.t.bufs
  if not bufnrs or #bufnrs == 0 then
    vim.notify "No buffers found with the provided options"
    return
  end

  opts.bufnr_width = #tostring(math.max(unpack(bufnrs)))

  local buffers = {}
  local default_selection_idx = 1
  for i, bufnr in ipairs(bufnrs) do
    local flag = bufnr == vim.fn.bufnr "" and "%" or (bufnr == vim.fn.bufnr "#" and "#" or " ")
    local element = { bufnr = bufnr, flag = flag, info = vim.fn.getbufinfo(bufnr)[1] }

    if flag == "%" then default_selection_idx = i end
    table.insert(buffers, element)
  end

  local pickers = require "telescope.pickers"
  local finders = require "telescope.finders"
  local make_entry = require "telescope.make_entry"
  local actions = require "telescope.actions"
  local action_state = require "telescope.actions.state"
  local conf = require("telescope.config").values

  local function delete_buffer(prompt_bufnr)
    local current_picker = action_state.get_current_picker(prompt_bufnr)

    current_picker:delete_selection(function(selection)
      Tabufline.Close(selection.bufnr, function(bufnr)
        if bufnr ~= current_picker.original_bufnr then return vim.api.nvim_buf_delete(bufnr, { force = true }) end

        if #vim.t.bufs > 1 then
          local cur_buf_idx = Tabufline.BufIndex(bufnr)
          local next_buf_idx = cur_buf_idx == #vim.t.bufs and -1 or 1
          local next_buf_nr = vim.t.bufs[cur_buf_idx + next_buf_idx]

          vim.api.nvim_win_set_buf(current_picker.original_win_id, next_buf_nr)
          current_picker.original_bufnr = next_buf_nr
        else
          local empty_buf = vim.api.nvim_create_buf(true, true)

          vim.api.nvim_win_set_buf(current_picker.original_win_id, empty_buf)
          current_picker.original_bufnr = empty_buf

          actions.close(prompt_bufnr)
        end

        vim.api.nvim_buf_delete(bufnr, { force = true })
      end)
    end)
  end

  local function move_buffer_to_tab(prompt_bufnr)
    local picker = action_state.get_current_picker(prompt_bufnr)
    local selections = picker:get_multi_selection()

    if vim.tbl_isempty(selections) then table.insert(selections, action_state.get_selected_entry()) end
    if vim.tbl_isempty(selections) then return vim.notify("No buffer selected", vim.log.levels.WARN) end

    local bufnrs_to_move = vim.tbl_map(function(s)
      return s.bufnr
    end, selections)

    local current_tab = vim.api.nvim_get_current_tabpage()
    local other_tabs = vim.tbl_filter(function(t)
      return t ~= current_tab
    end, vim.api.nvim_list_tabpages())

    if #other_tabs == 0 then return vim.notify("No other tab to move to", vim.log.levels.INFO) end

    local tab_choices = {}
    local tab_map = {}

    for i, t in ipairs(other_tabs) do
      local tab_nr = vim.api.nvim_tabpage_get_number(t)
      table.insert(tab_choices, "Tab " .. tab_nr)

      tab_map[i] = t
    end

    vim.ui.select(tab_choices, { prompt = "Move buffer to tab:" }, function(_, idx)
      if not idx then return end

      local target_tab = tab_map[idx]

      -- append to target tab bufs
      local target_bufs = vim.t[target_tab].bufs or {}
      for _, bufnr in ipairs(bufnrs_to_move) do
        if not vim.tbl_contains(target_bufs, bufnr) then table.insert(target_bufs, bufnr) end
      end

      vim.o.lazyredraw = true
      vim.t[target_tab].bufs = target_bufs

      -- handle current tab
      local wins_to_update = {}
      local wins = vim.api.nvim_tabpage_list_wins(current_tab)
      for _, win in ipairs(wins) do
        local win_buf = vim.api.nvim_win_get_buf(win)
        if vim.tbl_contains(bufnrs_to_move, win_buf) then table.insert(wins_to_update, win) end
      end

      local remaining_bufs = vim
        .iter(vim.t[current_tab].bufs)
        :filter(function(b)
          return not vim.tbl_contains(bufnrs_to_move, b)
        end)
        :totable()

      vim.t[current_tab].bufs = remaining_bufs

      if #remaining_bufs > 0 then
        local next_buf = remaining_bufs[#remaining_bufs]
        for _, win in ipairs(wins_to_update) do
          vim.api.nvim_win_set_buf(win, next_buf)
        end
      elseif #wins_to_update > 0 then
        local original_win = vim.api.nvim_get_current_win()

        vim.api.nvim_set_current_win(wins_to_update[1])
        vim.cmd "enew"

        local new_buf = vim.api.nvim_get_current_buf()

        vim.t[current_tab].bufs = { new_buf }

        for i = 2, #wins_to_update do
          vim.api.nvim_win_set_buf(wins_to_update[i], new_buf)
        end

        vim.api.nvim_set_current_win(original_win)
      end

      vim.o.lazyredraw = false
      vim.cmd "redraw!"

      vim.notify(string.format("Moved %d buffer(s) to Tab %d", #bufnrs_to_move, target_tab))
    end)
  end

  pickers
    .new(opts, {
      prompt_title = "Tab Buffers",
      finder = finders.new_table {
        results = buffers,
        entry_maker = make_entry.gen_from_buffer(opts),
      },
      previewer = conf.grep_previewer(opts),
      sorter = conf.generic_sorter(opts),
      default_selection_index = default_selection_idx,
      attach_mappings = function(_, map)
        map("i", "<C-c>", delete_buffer)
        map("i", "<M-m>", move_buffer_to_tab)
        return true
      end,
    })
    :find()
end

function M.scope_search(prompt_bufnr)
  local input = require("telescope.actions.state").get_current_line()

  local cwd = vim.uv.cwd()
  local find_command = M.config().pickers.find_files.find_command

  table.remove(find_command, 3)
  table.insert(find_command, 3, "directory")

  local function select_default(inner_prompt_bufnr)
    local picker = require("telescope.actions.state").get_current_picker(inner_prompt_bufnr)
    local selection = picker:get_multi_selection()

    local dirs = {}

    if vim.tbl_isempty(selection) then
      local entry = require("telescope.actions.state").get_selected_entry().value
      table.insert(dirs, entry)
    else
      for _, s in ipairs(selection) do
        table.insert(dirs, s.value)
      end
    end

    require("telescope.actions").close(inner_prompt_bufnr)

    M.grep {
      prompt_title = string.format("Grep Under (%s)", table.concat(dirs, ", ")),
      default_text = input,
      search_dirs = dirs,
    }
  end

  require("telescope.actions").close(prompt_bufnr)

  require("telescope.builtin").find_files {
    prompt_title = "Scope Search",
    cwd = cwd,
    find_command = find_command,
    attach_mappings = function(_, map)
      map("i", "<CR>", select_default)
      return true
    end,
  }
end

return M
