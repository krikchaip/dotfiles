return {
  -- 'navic',

  function()
    return require('nvim-navic').get_location()
  end,

  cond = function()
    return require('nvim-navic').is_available()
  end,

  -- "static" -> perform an adjustment once when the component is being setup.
  --   This should be enough when the lualine section isn't changing colors based on the mode.
  -- "dynamic" -> keep updating the highlights according to the current modes colors
  --   for the current section.
  -- color_correction = 'dynamic',

  -- uncomment this line if you put navic in section_a or section_b
  -- ref: https://github.com/SmiteshP/nvim-navic/issues/115
  -- padding = { left = 1, right = 0 },

  fmt = require('plugins.ui.navic.utils').adjust_dynamic_highlights(),
}
