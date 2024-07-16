-- A better :bdelete and :bwipeout that doesn't destroy your windows/tabs layout
return {
  -- Spec Source
  'moll/vim-bbye',
  name = 'vim-bbye',

  -- Spec Lazy Loading
  cmd = { 'Bdelete', 'Bwipeout' },
  keys = {
    { '<leader>x', '<cmd>Bdelete<CR>', desc = 'Buffer: Delete Current (Preserve Window)' },
    { '<leader>X', '<cmd>Bdelete!<CR>', desc = 'Buffer: Force Delete Current (Preserve Window)' },
  },
}
