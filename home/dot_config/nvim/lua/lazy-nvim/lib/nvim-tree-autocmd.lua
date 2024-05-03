-- Fix auto-session weird behaviour when saving sessions with nvim-tree open
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#workaround-when-using-rmagattiauto-session
vim.api.nvim_create_autocmd('BufEnter', {
  desc = 'Fix issue with restoring nvim-tree when using rmagatti/auto-session',
  group = vim.api.nvim_create_augroup('nvim-tree-auto-session', { clear = true }),
  pattern = 'NvimTree*',
  callback = function()
    local api = require 'nvim-tree.api'
    local view = require 'nvim-tree.view'

    if not view.is_visible() then
      api.tree.open()
    end
  end
})

-- Go to last used hidden buffer when deleting a buffer
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#go-to-last-used-hidden-buffer-when-deleting-a-buffer
vim.api.nvim_create_autocmd('BufEnter', {
  desc = 'Prevent nvim-tree from fully expand when there some buffers in the background',
  group = vim.api.nvim_create_augroup('nvim-tree-bdelete', { clear = true }),
  nested = true,
  callback = function()
    local api = require 'nvim-tree.api'

    -- Only 1 window with nvim-tree left: we probably closed a file buffer
    if #vim.api.nvim_list_wins() == 1 and api.tree.is_tree_buf() then
      -- Required to let the close event complete. An error is thrown without this.
      vim.defer_fn(function()
        -- close nvim-tree: will go to the last hidden buffer used before closing
        api.tree.toggle({ find_file = true, focus = true })

        -- re-open nivm-tree
        api.tree.toggle({ find_file = true, focus = true })

        -- nvim-tree is still the active window. Go to the previous window.
        vim.cmd('wincmd p')
      end, 0)
    end
  end
})
