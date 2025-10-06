return {
  {
    "nvim-mini/mini.ai",
    version = "*",
    event = "User FilePost",
    opts = {},
  },

  {
    "nvim-mini/mini.bracketed",
    version = "*",
    event = "User FilePost",
    opts = { diagnostic = { suffix = "" } },
  },

  {
    "nvim-mini/mini.move",
    version = "*",
    event = "User FilePost",
    opts = function(_, opts)
      return require("configs.mini.move").config(opts)
    end,
  },

  {
    "nvim-mini/mini.splitjoin",
    version = "*",
    event = "User FilePost",
    opts = { mappings = { toggle = "gs" } },
  },

  {
    "nvim-mini/mini.surround",
    version = "*",
    event = "User FilePost",
    opts = {},
  },

  {
    "nvim-mini/mini.files",
    version = "*",
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    config = function(_, opts)
      require("configs.mini.files").setup(opts)
    end,
  },
}
