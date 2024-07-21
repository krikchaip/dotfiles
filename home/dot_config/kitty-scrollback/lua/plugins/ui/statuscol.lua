-- 'statuscolumn' made EASY(?)
-- ref: https://github.com/luukvbaal/statuscol.nvim
return {
  -- Spec Source
  'luukvbaal/statuscol.nvim',
  name = 'statuscol',

  -- Spec Setup
  config = function()
    local statuscol = require 'statuscol'
    local builtin = require 'statuscol.builtin'

    statuscol.setup {
      -- whether to right-align the cursor line number with 'relativenumber' set
      relculright = false,

      -- filetype values for which 'statuscolumn' will be unset
      ft_ignore = {
        'DiffviewFileHistory',
        'DiffviewFiles',
        'NvimTree',
        'help',
        'trouble',
      },

      segments = {
        { text = { ' ', builtin.lnumfunc, '  ' }, click = 'v:lua.ScLa' },
      },
    }
  end,

  -- Spec Lazy Loading
  event = 'VeryLazy',
}
