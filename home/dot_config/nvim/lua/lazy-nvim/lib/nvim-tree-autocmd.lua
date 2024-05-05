---@diagnostic disable: param-type-mismatch

-- Fix auto-session weird behaviour when saving sessions with nvim-tree open
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#workaround-when-using-rmagattiauto-session
vim.api.nvim_create_autocmd('BufEnter', {
  desc = 'Fix issue with restoring nvim-tree when using rmagatti/auto-session',
  group = vim.api.nvim_create_augroup('nvim-tree-autosession', { clear = true }),
  pattern = 'NvimTree*',
  callback = function()
    local api = require 'nvim-tree.api'
    local view = require 'nvim-tree.view'

    if not view.is_visible() then
      api.tree.open()
    end
  end
})

-- Go to last used hidden buffer after deleting a buffer
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Recipes#go-to-last-used-hidden-buffer-when-deleting-a-buffer
-- vim.api.nvim_create_autocmd('BufEnter', {
--   desc = 'Prevent nvim-tree from fully expand when there some buffers in the background',
--   group = vim.api.nvim_create_augroup('nvim-tree-bdelete', { clear = true }),
--   nested = true,
--   callback = function()
--     local api = require 'nvim-tree.api'
--
--     -- Only 1 window with nvim-tree left: we probably closed a file buffer
--     if #vim.api.nvim_list_wins() == 1 and api.tree.is_tree_buf() then
--       -- Required to let the close event complete. An error is thrown without this.
--       vim.defer_fn(function()
--         -- close nvim-tree: will go to the last hidden buffer used before closing
--         api.tree.toggle({ find_file = true, focus = true })
--
--         -- re-open nivm-tree
--         api.tree.toggle({ find_file = true, focus = true })
--
--         -- nvim-tree is still the active window. Go to the previous window.
--         vim.cmd('wincmd p')
--       end, 0)
--     end
--   end
-- })

-- Autoclose nvim-tree if it is the last buffer in a tab
-- (only works with `:q`, `:qa` and `<C-W>q` or any other window cmds)
-- ref: https://github.com/nvim-tree/nvim-tree.lua/wiki/Auto-Close#rwblokzijl
-- vim.api.nvim_create_autocmd('WinClosed', {
--   desc = 'Close the tab/nvim when nvim-tree is the last window',
--   group = vim.api.nvim_create_augroup('nvim-tree-autoclose', { clear = true }),
--   nested = true,
--   callback = function()
--     local api = require 'nvim-tree.api'
--
--     local winnr = tonumber(vim.fn.expand('<amatch>'))
--
--     local bufnr = vim.api.nvim_win_get_buf(winnr)
--     local tabnr = vim.api.nvim_win_get_tabpage(winnr)
--
--     local buf_info = vim.fn.getbufinfo(bufnr)[1]
--     local tab_wins = vim.tbl_filter(function(w) return w ~= winnr end, vim.api.nvim_tabpage_list_wins(tabnr))
--     local tab_bufs = vim.tbl_map(vim.api.nvim_win_get_buf, tab_wins)
--
--     if buf_info.name:match(".*NvimTree_%d*$") then -- close buffer was nvim tree
--       -- Close all nvim tree on :q
--       if not vim.tbl_isempty(tab_bufs) then        -- and was not the last window (not closed automatically by code below)
--         api.tree.close()
--       end
--     else                                                    -- else closed buffer was normal buffer
--       if #tab_bufs == 1 then                                -- if there is only 1 buffer left in the tab
--         local last_buf_info = vim.fn.getbufinfo(tab_bufs[1])[1]
--         if last_buf_info.name:match(".*NvimTree_%d*$") then -- and that buffer is nvim tree
--           vim.schedule(function()
--             if #vim.api.nvim_list_wins() == 1 then          -- if its the last buffer in vim
--               vim.cmd "quit"                                -- then close all of vim
--             else                                            -- else there are more tabs open
--               vim.api.nvim_win_close(tab_wins[1], true)     -- then close only the tab
--             end
--           end)
--         end
--       end
--     end
--   end
-- })
