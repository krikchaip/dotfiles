return {
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
    opts = { diagnostic = { suffix = "" } },
  },

  {
    "echasnovski/mini.move",
    version = "*",
    event = "User FilePost",
    opts = function(_, opts)
      return require("configs.mini.move").config(opts)
    end,
  },

  {
    "echasnovski/mini.splitjoin",
    version = "*",
    event = "User FilePost",
    opts = { mappings = { toggle = "gs" } },
  },

  {
    "echasnovski/mini.surround",
    version = "*",
    event = "User FilePost",
    opts = {},
  },

  {
    "echasnovski/mini.files",
    version = "*",
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    config = function(_, opts)
      require("configs.mini.files").setup(opts)
    end,
  },
}
