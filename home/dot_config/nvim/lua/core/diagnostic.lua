-- Change the Diagnostic symbols in the sign column (gutter)
local signs = {
  Error = '',
  Warn  = '',
  Hint  = '',
  Info  = '',
}

for type, icon in pairs(signs) do
  local hl = 'DiagnosticSign' .. type

  -- [[ diagnostic-signs ]]
  vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = '' })
end

vim.diagnostic.config({
  virtual_text = false,
  update_in_insert = true,
  float = {
    -- [[ vim.lsp.util.open_floating_preview() ]]
    focus = false, -- disable initial focus
    wrap = true,   -- wrap long lines
    -- wrap_at = 80,  -- character to wrap at for computing height when enabled
    max_width = 80,
    close_events = {
      'BufHidden',
      'BufLeave',
      'CursorMoved',
      'CursorMovedI',
      'FocusLost',
      'InsertCharPre',
      'InsertEnter',
      'WinLeave',
    },

    -- [[ vim.diagnostic.open_float() ]]
    scope = 'cursor' -- cursor, line, buffer
  },
})
