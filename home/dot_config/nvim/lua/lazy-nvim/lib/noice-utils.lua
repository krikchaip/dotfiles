local M = {}

M.skip_annoying_messages = {
  filter = {
    any = {
      -- written messages
      {
        event = 'msg_show',
        kind = '',
        find = 'written',
      },

      -- search messages
      {
        event = 'msg_show',
        kind = 'search_count',
      },

      -- etc.
      {
        event = 'msg_show',
        kind = '',
      },
    },
  },
  opts = { skip = true },
}

M.skip_luals_progress_messages = {
  filter = {
    event = 'lsp',
    kind = 'progress',
    cond = function(message)
      local client = vim.tbl_get(message.opts, 'progress', 'client')
      return client == 'lua_ls'
    end,
  },
  opts = { skip = true },
}

return M
