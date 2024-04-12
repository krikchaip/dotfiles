return {
  -- NOTE: Plugins can also be configured to run Lua code when they are loaded.
  --
  -- This is often very useful to both group configuration, as well as handle
  -- lazy loading plugins that don't need to be loaded immediately at startup.
  --
  -- For example, in the following configuration, we use:
  --  event = 'VimEnter'
  --
  -- which loads which-key before all the UI elements are loaded. Events can be
  -- normal autocommands events (`:help autocmd-events`).
  --
  -- Then, because we use the `config` key, the configuration only runs
  -- after the plugin has been loaded:
  --  config = function() ... end

  {
    'folke/which-key.nvim', -- Useful plugin to show you pending keybinds.
    event = 'VimEnter',     -- Sets the loading event to 'VimEnter'
    config = function()     -- This is the function that runs, AFTER loading
      require('which-key').setup {
        icons = {
          breadcrumb = "»", -- symbol used in the command line area that shows your active key combo
          separator = ">",  -- symbol used between a key and it's label
          group = "+",      -- symbol prepended to a group
        },
      }

      -- Document existing key chains
      -- see: https://github.com/folke/which-key.nvim?tab=readme-ov-file#-setup
      require('which-key').register {
        ['<C-,>'] = { name = 'NVim settings', _ = 'which_key_ignore' },
        ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },
        ['<leader>e'] = { name = 'Explorer', _ = 'which_key_ignore' },
      }
    end,
  },
}
