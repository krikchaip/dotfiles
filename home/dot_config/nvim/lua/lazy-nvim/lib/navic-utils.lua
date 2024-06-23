local M = {}

-- Fix background color does not inherit from lualine section when `highlight = true`
-- ref: https://github.com/SmiteshP/nvim-navic/issues/146
function M.adjust_dynamic_highlights()
  return function(text)
    local navicHls = {
      'IconsFile',
      'IconsModule',
      'IconsNamespace',
      'IconsPackage',
      'IconsClass',
      'IconsMethod',
      'IconsProperty',
      'IconsField',
      'IconsConstructor',
      'IconsEnum',
      'IconsInterface',
      'IconsFunction',
      'IconsVariable',
      'IconsConstant',
      'IconsString',
      'IconsNumber',
      'IconsBoolean',
      'IconsArray',
      'IconsObject',
      'IconsKey',
      'IconsNull',
      'IconsEnumMember',
      'IconsStruct',
      'IconsEvent',
      'IconsOperator',
      'IconsTypeParameter',
      'Text',
      'Separator',
    }

    local lualineHl = vim.api.nvim_get_hl(0, { name = 'lualine_c_inactive' })
    local bg = lualineHl.bg and ('#%06x'):format(lualineHl.bg)

    for _, hlName in ipairs(navicHls) do
      hlName = 'Navic' .. hlName

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
