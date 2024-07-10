return {
  -- Spec Source
  'NeogitOrg/neogit',
  name = 'neogit',

  -- Spec Setup
  config = function()
    require 'plugins.git.neogit.setup'
  end,

  -- Spec Lazy Loading
  cmd = { 'Neogit' },
  keys = {
    { '<C-g>', '<cmd>Neogit<CR>', desc = 'Git: Show Status' },
    { '<leader>gs', '<cmd>Neogit<CR>', desc = 'Git: Show Status' },
    { '<leader>gc', '<cmd>Neogit commit<CR>', desc = 'Git: Open Commit Popup' },
  },
}
