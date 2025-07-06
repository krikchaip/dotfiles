require('chezmoi').setup {
  -- edit = {
  --   watch = true,
  --   force = false,
  -- },

  events = {
    on_watch = { notification = { enable = false } },
  },

  -- telescope = {
  --   select = { '<CR>' },
  -- },
}
