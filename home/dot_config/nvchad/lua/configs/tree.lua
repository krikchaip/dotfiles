local M = {}

M.config = function(opts)
  opts.select_prompts = true
  opts.reload_on_bufenter = true

  opts.view.centralize_selection = true

  opts.renderer.full_name = true
  opts.renderer.indent_width = 1
  opts.renderer.indent_markers.enable = false
  opts.renderer.highlight_diagnostics = "name"
  opts.renderer.icons.web_devicons = { folder = { enable = true } }

  opts.update_focused_file.enable = false

  opts.diagnostics = { enable = true, show_on_dirs = true }

  -- hide .git directory
  -- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Tips#hide-git-directory
  opts.filters.custom = { "^.git$" }

  opts.live_filter = { always_show_folders = false }

  opts.actions = {
    change_dir = { enable = false },
    expand_all = { exclude = { ".git", "target", "build" } },
    open_file = { window_picker = { enable = false } },
  }

  opts.help = { sort_by = "desc" }

  return opts
end

M.setup = function(opts)
  require("nvim-tree").setup(M.config(opts))

  vim.g.auto_reveal = true
end

return M
