return {
  {
    "stevearc/conform.nvim",
    -- event = 'BufWritePre', -- uncomment for format on save
    opts = require "configs.conform",
  },

  {
    "neovim/nvim-lspconfig",
    config = function()
      require("configs.lspconfig").setup()
    end,
  },

  {
    "nvim-telescope/telescope.nvim",
    config = function(_, opts)
      require("configs.telescope").setup(opts)
    end,
  },

  -- { import = "nvchad.blink.lazyspec" },

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
}
