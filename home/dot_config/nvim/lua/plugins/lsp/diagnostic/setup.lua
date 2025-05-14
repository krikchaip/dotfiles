local signs = {
  text = {},
  texthl = {},
  numhl = {},
}

for type, icon in pairs(vim.g.diagnostic_signs) do
  local hl = 'DiagnosticSign' .. type
  local severity = vim.diagnostic.severity[string.upper(type)]

  signs.text[severity] = icon
  signs.texthl[severity] = hl
  signs.numhl[severity] = ''
end

vim.diagnostic.config {
  signs = signs,

  virtual_text = false,
  update_in_insert = false,

  float = {
    max_width = 80,

    -- disable initial focus
    focus = false,

    -- wrap long lines
    wrap = true,

    -- character to wrap at for computing height when enabled
    -- wrap_at = 80,

    -- cursor, line, buffer
    scope = 'cursor',

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
  },
}
