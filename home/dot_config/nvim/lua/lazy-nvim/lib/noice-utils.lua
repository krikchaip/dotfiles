local M = {}

M.skip_written_messages = {
  filter = {
    event = 'msg_show',
    kind = '',
    find = 'written',
  },
  opts = { skip = true },
}

M.skip_search_messages = {
  filter = {
    event = 'msg_show',
    kind = 'search_count',
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
