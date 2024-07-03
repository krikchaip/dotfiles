local NAVIC_HLS = {
  NavicIconsFile = 'DevIconC', -- "󰈙 "
  NavicIconsModule = 'DevIconH', -- " "
  NavicIconsNamespace = '@lsp.type.namespace', -- "󰌗 "
  NavicIconsPackage = 'DevIconCue', -- " "
  NavicIconsClass = '@lsp.type.class', -- "󰌗 "
  NavicIconsMethod = '@lsp.type.method', -- "󰆧 "
  NavicIconsProperty = '@lsp.type.property', -- " "
  NavicIconsField = 'DevIconCss', -- " "
  NavicIconsConstructor = '@constructor', -- " "
  NavicIconsEnum = '@lsp.type.enum', -- "󰕘 "
  NavicIconsInterface = '@lsp.type.interface', -- "󰕘 "
  NavicIconsFunction = '@lsp.type.function', -- "󰊕 "
  NavicIconsVariable = '@variable.parameter.builtin', -- "󰆧 "
  NavicIconsConstant = '@constant', -- "󰏿 "
  NavicIconsString = '@lsp.type.string', -- "󰀬 "
  NavicIconsNumber = '@lsp.type.number', -- "󰎠 "
  NavicIconsBoolean = '@lsp.type.boolean', -- "◩ "
  NavicIconsArray = '@markup.list', -- "󰅪 "
  NavicIconsObject = 'DevIconCjs', -- "󰅩 "
  NavicIconsKey = '@lsp.type.keyword', -- "󰌋 "
  NavicIconsNull = 'DevIconGroovy', -- "󰟢 "
  NavicIconsEnumMember = '@lsp.type.enumMember', -- " "
  NavicIconsStruct = '@lsp.type.struct', -- "󰌗 "
  NavicIconsEvent = '@lsp.type.event', -- " "
  NavicIconsOperator = '@lsp.type.operator', -- "󰆕 "
  NavicIconsTypeParameter = '@lsp.type.typeParameter', -- "󰊄 "
  NavicText = 'lualine_c_normal',
  NavicSeparator = 'lualine_c_normal',
}

local M = {}

function M.setup_highlights()
  for hl, val in pairs(NAVIC_HLS) do
    if val and type(val) == 'string' then vim.api.nvim_set_hl(0, hl, { link = val }) end
    if val and type(val) == 'table' then vim.api.nvim_set_hl(0, hl, val) end
  end
end

-- Fix background color does not inherit from lualine section when `highlight = true`
-- ref: https://github.com/SmiteshP/nvim-navic/issues/146
function M.adjust_dynamic_highlights()
  local highlights = vim.tbl_keys(NAVIC_HLS)

  return function(text)
    local lualineHl = vim.api.nvim_get_hl(0, { name = 'lualine_c_inactive' })
    local bg = lualineHl.bg and ('#%06x'):format(lualineHl.bg)

    for _, hlName in ipairs(highlights) do
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
