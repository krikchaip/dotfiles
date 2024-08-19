local devicons = require 'nvim-web-devicons'
local helpers = require 'incline.helpers'

local M = {}

local function filename_with_icons(props)
  local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ':t')
  if filename == '' then filename = '[No Name]' end

  local modified = vim.bo[props.buf].modified

  local ft_icon, ft_color = devicons.get_icon_color(filename)
  local file_icon = ft_icon and { ' ', ft_icon, ' ', guibg = ft_color, guifg = helpers.contrast_color(ft_color) } or ''

  local file_label = { filename }

  return { file_icon, ' ', file_label, ' ' }
end

-- TODO: filetype + filename + modified icon, file diagnostics
M.render = function(props)
  return {
    filename_with_icons(props),
    guibg = '#44406e',
  }
end

return M
