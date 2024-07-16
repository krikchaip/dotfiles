local M = {}

function M.next_hunk()
  if vim.wo.diff then
    vim.cmd.normal { ']c', bang = true }
  else
    require('gitsigns').nav_hunk('next', { preview = false })
  end
end

function M.prev_hunk()
  if vim.wo.diff then
    vim.cmd.normal { '[c', bang = true }
  else
    require('gitsigns').nav_hunk('prev', { preview = false })
  end
end

return M
