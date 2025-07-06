return {
  'diff',

  source = function()
    local gitsigns = vim.b.gitsigns_status_dict

    if gitsigns then return {
      added = gitsigns.added,
      modified = gitsigns.changed,
      removed = gitsigns.removed,
    } end
  end,

  on_click = function()
    vim.cmd [[DiffviewOpen]]
  end,
}
