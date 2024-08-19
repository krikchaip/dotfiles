local devicons = require 'nvim-web-devicons'

local M = {}

local function filename_with_icons(props)
  local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
  if filename == '' then filename = '[No Name]' end

  local modified = vim.bo[props.buf].modified

  local ft_icon, ft_color = devicons.get_icon_color(filename)
  local file_icon = ft_icon and { ' ', ft_icon, ' ', guifg = ft_color } or ' '

  local file_label = { filename }

  local modifed_hl = props.focused and {} or { group = 'lualine_b_visual' }
  local modified_icon = modified and vim.tbl_extend('force', { ' ', '●', ' ' }, modifed_hl) or ' '

  return {
    file_icon,
    file_label,
    modified_icon,

    group = props.focused and 'lualine_a_normal' or 'lualine_b_normal',
  }
end

-- TODO: filetype + filename + modified icon, file diagnostics
M.render = function(props)
  return {
    filename_with_icons(props),
  }
end

return M
