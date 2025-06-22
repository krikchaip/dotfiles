local M = {}

M.config = function(opts)
  opts.auto_install = true

  opts.ensure_installed = {
    "git_config",
    "git_rebase",
    "gitattributes",
    "gitcommit",
    "gitignore",

    "bash",
    "nu",
    "tmux",
    "make",

    "lua",
    "luadoc",

    "vim",
    "vimdoc",

    "regex",

    "html",
    "css",
    "javascript",
    "typescript",
    "tsx",
    "vue",

    "python",
    "requirements",

    "go",
    "gomod",
    "gosum",
    "gotmpl",
    "gowork",

    "json",
    "jsonc",
    "yaml",

    "dockerfile",

    "markdown",
    "markdown_inline",
  }

  opts.incremental_selection = {
    enable = true,
    keymaps = {
      init_selection = "<C-S-=>",
      node_incremental = "<C-S-=>",
      node_decremental = "<C-S-->",
      scope_incremental = false,
    },
  }

  return opts
end

return M
