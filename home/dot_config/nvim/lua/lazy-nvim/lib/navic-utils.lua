local NAVIC_HLS = {
  'NavicIconsFile',
  'NavicIconsModule',
  'NavicIconsNamespace',
  'NavicIconsPackage',
  'NavicIconsClass',
  'NavicIconsMethod',
  'NavicIconsProperty',
  'NavicIconsField',
  'NavicIconsConstructor',
  'NavicIconsEnum',
  'NavicIconsInterface',
  'NavicIconsFunction',
  'NavicIconsVariable',
  'NavicIconsConstant',
  'NavicIconsString',
  'NavicIconsNumber',
  'NavicIconsBoolean',
  'NavicIconsArray',
  'NavicIconsObject',
  'NavicIconsKey',
  'NavicIconsNull',
  'NavicIconsEnumMember',
  'NavicIconsStruct',
  'NavicIconsEvent',
  'NavicIconsOperator',
  'NavicIconsTypeParameter',
  'NavicText',
  'NavicSeparator',
}

local M = {}

function M.setup_highlights() end

-- Fix background color does not inherit from lualine section when `highlight = true`
-- ref: https://github.com/SmiteshP/nvim-navic/issues/146
function M.adjust_dynamic_highlights()
  return function(text)
    local lualineHl = vim.api.nvim_get_hl(0, { name = 'lualine_c_inactive' })
    local bg = lualineHl.bg and ('#%06x'):format(lualineHl.bg)

    for _, hlName in ipairs(NAVIC_HLS) do
      local orgHl = hlName
      local hl

      repeat -- follow linked highlights
        hl = vim.api.nvim_get_hl(0, { name = hlName })
        hlName = hl.link
      until not hl.link

      vim.api.nvim_set_hl(0, orgHl, { fg = hl.fg, bg = bg })
    end

    return text
  end
end

return M
