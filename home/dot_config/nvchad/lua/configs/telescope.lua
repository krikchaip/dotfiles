local M = {}

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

M.config = function(opts)
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
    help_tags = {
      mappings = {
        i = {
          ["<CR>"] = "select_tab",
        },
      },
    },

    man_pages = {
      mappings = {
        i = {
          ["<CR>"] = "select_tab",
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

return M
