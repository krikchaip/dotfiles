return {
  'diagnostics',

  sources = {
    'nvim_diagnostic',
    -- 'nvim_workspace_diagnostic',
    'nvim_lsp',
  },

  update_in_insert = false, -- Update diagnostics in insert mode.
  always_visible = false, -- Show diagnostics even if there are none.

  on_click = function()
    require('trouble').focus { mode = 'diag', filter = { buf = 0 } }
  end,
}
