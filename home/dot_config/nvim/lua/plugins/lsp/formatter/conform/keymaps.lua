local function format_and_write()
  require('conform').format({ async = false }, function(err, _)
    if err then vim.notify_once(err, vim.log.levels.ERROR) end
    vim.cmd [[write]]
  end)
end

local function format_context()
  require('conform').format { async = true }
end

return {
  { '<leader>w', format_and_write, desc = 'Buffer: Format and Write Current' },
  { '<leader>=', format_context, desc = 'Format: Current Context', mode = { 'n', 'x' } },
}
