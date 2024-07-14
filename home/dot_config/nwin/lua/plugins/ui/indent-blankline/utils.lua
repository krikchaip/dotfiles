-- use the default highlight groups from rainbow-delimiters plugin
local HIGHLIGHTS = {
  { hl = 'RainbowDelimiterRed', link = 'DiagnosticError' },
  { hl = 'RainbowDelimiterYellow', link = '@variable.parameter' },
  { hl = 'RainbowDelimiterBlue', link = '@function' },
  { hl = 'RainbowDelimiterOrange', link = '@constant' },
  { hl = 'RainbowDelimiterGreen', link = 'DiagnosticHint' },
  { hl = 'RainbowDelimiterViolet', link = '@keyword' },
  { hl = 'RainbowDelimiterCyan', link = '@operator' },
}

local M = {}

M.highlight = vim.tbl_map(function(chl)
  return chl.hl
end, HIGHLIGHTS)

function M.setup_highlights()
  local hooks = require 'ibl.hooks'

  -- create the highlight groups in the highlight setup hook, so they are reset
  -- every time the colorscheme changes
  hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
    for _, hl in ipairs(custom_highlight) do
      vim.api.nvim_set_hl(0, hl.hl, { link = hl.link })
    end
  end)

  -- This is to be used to get a reliable sync with 'rainbow-delimiters' plugin
  hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)
end

return M
