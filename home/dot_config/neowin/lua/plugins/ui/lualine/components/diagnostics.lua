---@diagnostic disable: missing-parameter

--- @param scope? 'local'|'workspace'
return function(scope)
  scope = scope or 'local'

  local source = scope == 'local' and 'nvim_diagnostic' or 'nvim_workspace_diagnostic'
  local trouble_filter = scope == 'local' and { buf = 0 } or nil

  return {
    'diagnostics',

    sources = { source, 'nvim_lsp' },

    update_in_insert = false, -- Update diagnostics in insert mode.
    always_visible = false, -- Show diagnostics even if there are none.

    on_click = function()
      require('trouble').focus { mode = 'diag', filter = trouble_filter }
    end,
  }
end
