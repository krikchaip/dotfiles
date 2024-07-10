local utils = require 'plugins.git.gitsigns.utils'

return function(bufnr)
  -- set buffer to `0` or `true` for current buffer
  local kopts = { buffer = bufnr, silent = true }

  kopts.desc = 'Git: Unstaged Hunk'
  vim.keymap.set('n', ']c', utils.next_hunk, kopts)

  kopts.desc = 'Git: Unstaged Hunk'
  vim.keymap.set('n', '[c', utils.prev_hunk, kopts)

  kopts.desc = 'Git: Show Line Info'
  vim.keymap.set('n', '<leader>gi', function()
    require('gitsigns').blame_line { full = true }
  end, kopts)

  kopts.desc = 'Git: Stage hunk under cursor'
  vim.keymap.set('n', '<leader>ghs', function()
    require('gitsigns').stage_hunk()
  end, kopts)

  kopts.desc = 'Git: Stage highlighted hunk'
  vim.keymap.set('v', '<leader>ghs', function()
    require('gitsigns').stage_hunk { vim.fn.line '.', vim.fn.line 'v' }
  end, kopts)

  kopts.desc = 'Git: Stage all hunks'
  vim.keymap.set('n', '<leader>ghS', function()
    require('gitsigns').stage_buffer()
  end, kopts)

  kopts.desc = 'Git: Unstage all hunks'
  vim.keymap.set('n', '<leader>ghU', function()
    require('gitsigns').reset_buffer_index()
  end, kopts)

  kopts.desc = 'Git: Reset hunk under cursor to staged'
  vim.keymap.set('n', '<leader>ghr', function()
    require('gitsigns').reset_hunk()
  end, kopts)

  kopts.desc = 'Git: Reset highlighted hunk to staged'
  vim.keymap.set('v', '<leader>ghr', function()
    require('gitsigns').reset_hunk { vim.fn.line '.', vim.fn.line 'v' }
  end, kopts)

  kopts.desc = 'Git: Reset all hunks to staged'
  vim.keymap.set('n', '<leader>ghR', function()
    require('gitsigns').reset_buffer()
  end, kopts)

  kopts.desc = 'Git: Hunk under cursor'
  vim.keymap.set({ 'o', 'x' }, 'ic', function()
    require('gitsigns').select_hunk()
  end, kopts)

  kopts.desc = 'Git: Hunk under cursor'
  vim.keymap.set({ 'o', 'x' }, 'ac', function()
    require('gitsigns').select_hunk()
  end, kopts)
end
