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

return M
