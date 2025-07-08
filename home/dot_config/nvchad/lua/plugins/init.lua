return {
  { import = "nvchad.blink.lazyspec" },
  {
    "saghen/blink.cmp",
    opts = function(_, opts)
      return require("configs.blink").config(opts)
    end,
  },

  {
    "kevinhwang91/nvim-bqf",
    ft = "qf",
    config = function(_, opts)
      require("configs.bqf").setup(opts)
    end,
  },

  {
    "bfontaine/Brewfile.vim",
    event = { "BufReadPre *Brewfile", "BufNewFile *Brewfile" },
  },

  {
    "alker0/chezmoi.vim",
    lazy = false,
    init = function()
      vim.g["chezmoi#use_tmp_buffer"] = true
    end,
  },

  {
    "xvzc/chezmoi.nvim",
    event = {
      "BufReadPre */.local/share/chezmoi/*",
      "BufNewFile */.local/share/chezmoi/*",
    },
    config = function(_, opts)
      require("configs.chezmoi").setup(opts)
    end,
  },

  {
    "olimorris/codecompanion.nvim",
    cmd = { "CodeCompanion" },
    config = function(_, opts)
      require("configs.codecompanion").setup(opts)
    end,
  },

  {
    "stevearc/conform.nvim",
    opts = function(_, opts)
      return require("configs.conform").config(opts)
    end,
  },

  {
    "lewis6991/gitsigns.nvim",
    opts = function(_, opts)
      return require("configs.gitsigns").config(opts)
    end,
  },

  {
    "rmagatti/goto-preview",
    config = function()
      require("configs.goto-preview").setup()
    end,
  },

  {
    "MagicDuck/grug-far.nvim",
    config = function()
      require("configs.grug-far").setup()
    end,
  },

  {
    "folke/lazydev.nvim",
    ft = "lua",
    opts = { library = { { path = "snacks.nvim", words = { "Snacks" } } } },
  },

  {
    "mfussenegger/nvim-lint",
    event = "User FilePost",
    config = function()
      require("configs.lint").setup()
    end,
  },

  {
    "neovim/nvim-lspconfig",
    config = function()
      require("configs.lspconfig").setup()
    end,
  },

  {
    "hedyhli/outline.nvim",
    dependencies = {
      "epheien/outline-treesitter-provider.nvim",
      "bngarren/outline-test-blocks-provider.nvim",
    },
    cmd = { "Outline", "OutlineOpen" },
    opts = function(_, opts)
      return require("configs.outline").config(opts)
    end,
  },

  {
    "jedrzejboczar/possession.nvim",
    cmd = { "PossessionLoad", "PossessionLoadCwd" },
    opts = function(_, opts)
      return require("configs.possession").config(opts)
    end,
  },

  {
    "MeanderingProgrammer/render-markdown.nvim",
    ft = { "markdown", "codecompanion" },
    config = function(_, opts)
      require("configs.render-markdown").setup(opts)
    end,
  },

  { "b0o/schemastore.nvim" },

  {
    "petertriho/nvim-scrollbar",
    event = "User FilePost",
    config = function(_, opts)
      return require("configs.scrollbar").setup(opts)
    end,
  },

  {
    "folke/snacks.nvim",
    lazy = false,
    priority = 1000,
    opts = function(_, opts)
      return require("configs.snacks").config(opts)
    end,
  },

  { "benfowler/telescope-luasnip.nvim" },

  {
    "nvim-telescope/telescope-ui-select.nvim",
    event = "VeryLazy",
    config = function()
      require("configs.telescope-ui-select").setup()
    end,
  },

  {
    "nvim-telescope/telescope.nvim",
    config = function(_, opts)
      require("configs.telescope").setup(opts)
    end,
  },

  {
    "folke/todo-comments.nvim",
    event = "VeryLazy",
    opts = { signs = false, highlight = { multiline_pattern = "^%s+" } },
  },

  {
    "b0o/nvim-tree-preview.lua",
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    config = function(_, opts)
      require("configs.tree-preview").setup(opts)
    end,
  },

  {
    "nvim-tree/nvim-tree.lua",
    dependencies = { "b0o/nvim-tree-preview.lua" },
    config = function(_, opts)
      require("configs.tree").setup(opts)
    end,
  },

  {
    "nvim-treesitter/nvim-treesitter-context",
    event = "User FilePost",
    opts = { max_lines = 4, multiline_threshold = 1 },
  },

  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      return require("configs.treesitter").config(opts)
    end,
  },

  {
    "windwp/nvim-ts-autotag",
    event = "User FilePost",
    opts = { opts = { enable_close_on_slash = true } },
  },

  {
    "kevinhwang91/nvim-ufo",
    dependencies = { "kevinhwang91/promise-async" },
    event = "User FilePost",
    config = function(_, opts)
      require("configs.ufo").setup(opts)
    end,
  },

  { "folke/which-key.nvim", event = "VeryLazy" },
}
