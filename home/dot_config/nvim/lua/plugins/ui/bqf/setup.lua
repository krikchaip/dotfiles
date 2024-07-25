local IGNORED_FTS = { 'help' }

require('bqf').setup {
  -- Resize quickfix window height automatically.
  -- Shrink higher height to size of list in quickfix window,
  -- otherwise extend height to size of list or to default height (10)
  auto_resize_height = false,

  preview = {
    -- A callback function to decide whether to preview while switching buffer
    should_preview_cb = function(bufnr, _)
      local bufname = vim.api.nvim_buf_get_name(bufnr)
      local fsize = vim.fn.getfsize(bufname)
      local ft = vim.api.nvim_get_option_value('filetype', { buf = bufnr })

      if fsize > 100 * 1024 then
        return false
      elseif vim.tbl_contains(IGNORED_FTS, ft) then
        return false
      end

      return true
    end,
  },

  -- Keymaps for actions inside qf window
  func_map = require('plugins.ui.bqf.keymaps').qf_keys(),
}
