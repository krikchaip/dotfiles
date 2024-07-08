return {
  -- A collection of Nvim utility functions
  {
    'nvim-lua/plenary.nvim',
    name = 'plenary',
  },

  -- Neovim Throttle/Debounce function in Lua
  -- ref: https://github.com/runiq/neovim-throttle-debounce
  {
    'runiq/neovim-throttle-debounce',
    name = 'throttle-debounce',
  },

  -- Useful for getting pretty icons, but requires a Nerd Font to be installed
  {
    'nvim-tree/nvim-web-devicons',
    name = 'web-devicons',
    enabled = vim.g.have_nerd_font,
  },

  -- A Lua version of Javascript's Promise & Async-Await
  {
    'kevinhwang91/promise-async',
    name = 'promise-async',
  },

  -- Allows to amend the existing keybinding in Neovim
  {
    'anuvyklack/keymap-amend.nvim',
    name = 'keymap-amend',
    lazy = false,
    config = function()
      vim.keymap.amend = require 'keymap-amend'
    end,
  },

  -- UI Component Library for Neovim
  {
    'MunifTanjim/nui.nvim',
    name = 'nui',
  },

  -- Image previewer that supports kitty-based protocol
  {
    '3rd/image.nvim',
    name = 'image',
    commit = '94319cd', -- FIXME: pinned until the issue has been fixed
    lazy = false,
    opts = {
      max_width_window_percentage = 50,
      max_height_window_percentage = 50,

      -- toggles images when windows are overlapped
      window_overlap_clear_enabled = false,

      -- auto show/hide images when the editor gains/looses focus
      editor_only_render_when_focused = false,

      integrations = {
        html = { enabled = true },
        css = { enabled = true },
      },

      -- render image files as images when opened
      hijack_file_patterns = {
        '*.png',
        '*.svg',
        '*.jpg',
        '*.jpeg',
        '*.gif',
        '*.webp',
        '*.avif',
      },
    },
  },
}
