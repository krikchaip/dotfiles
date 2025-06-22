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
    opts = {},
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
}
