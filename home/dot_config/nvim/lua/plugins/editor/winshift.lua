return {
  -- Spec Source
  'sindrets/winshift.nvim',
  name = 'winshift',

  -- Spec Setup
  opts = {
    -- a function that should prompt the user to select a window to be swapped.
    window_picker = function()
      return require('window-picker').pick_window()
    end,
  },

  -- Spec Lazy Loading
  keys = {
    { '<C-w><C-m>', '<Cmd>WinShift<CR>', desc = 'Window: Start Win-Move Mode' },
    { '<C-w>m', '<Cmd>WinShift<CR>', desc = 'Window: Start Win-Move Mode' },

    { '<C-w><C-x>', '<Cmd>WinShift swap<CR>', desc = 'Window: Swap Current With Selection' },
    { '<C-w>x', '<Cmd>WinShift swap<CR>', desc = 'Window: Swap Current With Selection' },

    { '<C-w><C-h>', '<Cmd>WinShift left<CR>', desc = 'Window: Move Current Leftward' },
    { '<C-w>h', '<Cmd>WinShift left<CR>', desc = 'Window: Move Current Leftward' },

    { '<C-w><C-j>', '<Cmd>WinShift down<CR>', desc = 'Window: Move Current Downward' },
    { '<C-w>j', '<Cmd>WinShift down<CR>', desc = 'Window: Move Current Downward' },

    { '<C-w><C-k>', '<Cmd>WinShift up<CR>', desc = 'Window: Move Current Upward' },
    { '<C-w>k', '<Cmd>WinShift up<CR>', desc = 'Window: Move Current Upward' },

    { '<C-w><C-l>', '<Cmd>WinShift right<CR>', desc = 'Window: Move Current Rightward' },
    { '<C-w>l', '<Cmd>WinShift right<CR>', desc = 'Window: Move Current Rightward' },
  },
}
