return {
  { import = "nvchad.blink.lazyspec" },
  {
    "saghen/blink.cmp",
    opts = function(_, opts)
      return require("configs.blink").config(opts)
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
    event = "BufEnter",
    config = function()
      require("configs.goto-preview").setup()
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
    "echasnovski/mini.ai",
    version = "*",
    event = "User FilePost",
    opts = {},
  },

  {
    "echasnovski/mini.bracketed",
    version = "*",
    event = "User FilePost",
    opts = {},
  },

  {
    "jedrzejboczar/possession.nvim",
    cmd = { "PossessionLoad", "PossessionLoadCwd" },
    opts = function(_, opts)
      return require("configs.possession").config(opts)
    end,
  },

  { "b0o/schemastore.nvim" },

  {
    "folke/snacks.nvim",
    lazy = false,
    priority = 1000,
    opts = function(_, opts)
      return require("configs.snacks").config(opts)
    end,
  },

  {
    "nvim-telescope/telescope.nvim",
    config = function(_, opts)
      require("configs.telescope").setup(opts)
    end,
  },

  { "benfowler/telescope-luasnip.nvim" },

  {
    "nvim-tree/nvim-tree.lua",
    config = function(_, opts)
      require("configs.tree").setup(opts)
    end,
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

  { "folke/which-key.nvim", event = "VeryLazy" },
}
