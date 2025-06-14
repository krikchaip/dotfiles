local M = {}

M.config = function(opts)
  opts.defaults.mappings = {
    i = {
      -- close prompt
      ["<C-c>"] = false,
      ["<ESC>"] = "close",

      -- scrolling
      ["<PageDown>"] = false,
      ["<PageUp>"] = false,
      ["<M-d>"] = "results_scrolling_down",
      ["<M-u>"] = "results_scrolling_up",

      -- item selection (qflist)
      ["<C-q>"] = false,
      ["<M-Tab>"] = "drop_all",
    },
  }

  opts.pickers = {
    help_tags = {
      mappings = {
        i = {
          ["<CR>"] = "file_edit",
        },
      },
    },

    man_pages = {
      mappings = {
        i = {
          ["<CR>"] = "file_edit",
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
end

return M
