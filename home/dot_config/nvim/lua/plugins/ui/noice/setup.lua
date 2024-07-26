local utils = require 'plugins.ui.noice.utils'

require('noice').setup {
  cmdline = {
    format = {
      substitute = {
        icon = ' 󰑖',
        icon_hl_group = 'DiagnosticSignHint',
        lang = 'regex',
        pattern = { '^:%%?s;', "^:'<,'>s;" },
        view = 'cmdline',
      },
    },
  },

  messages = {
    -- use `hlslens` instead
    view_search = false,
  },

  lsp = {
    -- override markdown rendering so that **cmp** and other plugins use **Treesitter**
    override = {
      ['vim.lsp.util.convert_input_to_markdown_lines'] = true,
      ['vim.lsp.util.stylize_markdown'] = true,
      ['cmp.entry.get_documentation'] = true, -- requires hrsh7th/nvim-cmp
    },

    hover = {
      -- set to true to not show a message if hover is not available
      silent = true,
    },

    documentation = {
      opts = {
        size = { max_width = 60, max_height = 20 },
      },
    },
  },

  presets = {
    -- use a classic bottom cmdline for search
    bottom_search = true,

    -- position the cmdline and popupmenu together
    command_palette = false,

    -- long messages will be sent to a split
    long_message_to_split = true,

    -- add a border to hover docs and signature help
    lsp_doc_border = true,
  },

  routes = {
    utils.skip_annoying_messages,
    utils.notify_substitute_confirm,
    -- utils.skip_luals_progress_messages,
  },

  format = {
    lsp_progress_done = {
      { '✓ ', hl_group = 'NoiceLspProgressSpinner' },
      { '{data.progress.title} ', hl_group = 'NoiceLspProgressTitle' },
      { '{data.progress.client} ', hl_group = 'NoiceLspProgressClient' },
    },
  },
}
