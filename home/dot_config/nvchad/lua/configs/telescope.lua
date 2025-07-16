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

    buffers = {
      ignore_current_buffer = true,
      sort_lastused = true,
      sort_mru = true,

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

  require("telescope.builtin").grep_string(opts)
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

  local function select_default(prompt_bufnr)
    local selection = require("telescope.actions.state").get_selected_entry()
    local filename = selection.value or selection.filename or selection[1]
    local filepath = vim.fs.joinpath(selection.cwd, filename)

    if vim.uv.fs_stat(filepath).type == "file" then
      require("telescope.actions").select_default(prompt_bufnr)
      return
    end

    require("telescope.actions").close(prompt_bufnr)

    require("mini.files").open(filepath, true)
    -- require("configs.mini.files").reset()
  end

  local attach_mappings = opts.attach_mappings
  opts.attach_mappings = function(_, map)
    map("i", "<CR>", select_default)

    if attach_mappings then
      return attach_mappings(_, map)
    else
      return true
    end
  end

  require("telescope.builtin").find_files(opts)
end

M.scope_search = function(prompt_bufnr)
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
