local filename = require 'plugins.ui.lualine.components.filename'

--- @param inactive? boolean
return function(inactive)
  inactive = inactive or false

  return {
    {
      'filetype',
      colored = true,
      icon_only = true,
      separator = '',
      padding = { left = 1, right = 0 },

      fmt = function(text)
        if text == '' then return ' ' end
        return text
      end,
    },
    vim.tbl_extend('force', filename, {
      padding = 0,
      separator = '',
      symbols = vim.tbl_extend('force', filename.symbols, { modified = '' }),
      on_click = function() end,
    }),
    {
      function()
        return vim.bo.modified and '● ' or ' '
      end,
      padding = { left = 0 },
      color = function()
        if not inactive then return nil end

        local utils = require 'lualine.utils.utils'

        local fg = utils.extract_highlight_colors('lualine_b_visual', 'fg')
        local bg = utils.extract_highlight_colors('lualine_c_inactive', 'bg')

        return { fg = fg, bg = bg }
      end,
    },
  }
end
