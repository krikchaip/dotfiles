return {
  -- Spec Source
  'akinsho/toggleterm.nvim',
  name = 'toggleterm',

  -- Spec Setup
  config = function()
    require('toggleterm').setup {
      open_mapping = '<C-\\>', -- the key to use for toggling the terminal

      insert_mappings = true, -- whether if the mapping also take effect in insert mode
      terminal_mappings = true, -- whether if the mapping also take effect inside a terminal

      autochdir = true, -- auto change the terminal's cwd on next open
    }
  end,

  -- Spec Lazy Loading
  keys = {
    { '<C-\\>', desc = 'Toggle Terminal', mode = { 'n', 'i' } },
  },
}
