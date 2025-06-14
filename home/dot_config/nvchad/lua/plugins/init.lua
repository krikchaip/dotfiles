return {
  {
    "stevearc/conform.nvim",
    -- event = 'BufWritePre', -- uncomment for format on save
    opts = require "configs.conform",
  },

  {
    "neovim/nvim-lspconfig",
    config = function()
      require "configs.lspconfig"
    end,
  },

  {
    "nvim-telescope/telescope.nvim",
    opts = function(_, opts)
      require("configs.telescope").config(opts)
    end,
  },

  -- { import = "nvchad.blink.lazyspec" },

  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      require("configs.treesitter").config(opts)
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
}
