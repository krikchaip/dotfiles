-- like `Expand Selection` feature in VSCode
return {
  enable = true,

  keymaps = {
    init_selection = '<C-S-=>',
    node_incremental = '<C-S-=>',
    node_decremental = '<C-S-->',
    scope_incremental = false,
  },
}
