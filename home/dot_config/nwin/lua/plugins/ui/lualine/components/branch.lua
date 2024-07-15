return {
  -- 'branch',
  'b:gitsigns_head',

  icon = '',

  on_click = function()
    require('telescope.builtin').git_branches()
  end,
}
