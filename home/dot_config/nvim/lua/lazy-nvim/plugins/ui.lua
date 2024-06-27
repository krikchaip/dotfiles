local lualine_utils = require 'lazy-nvim.lib.lualine-utils'
local noice_utils = require 'lazy-nvim.lib.noice-utils'
local tabby_utils = require 'lazy-nvim.lib.tabby-utils'
local trouble_utils = require 'lazy-nvim.lib.trouble-utils'
local ufo_utils = require 'lazy-nvim.lib.ufo-utils'

return {
  -- Useful plugin to show you pending keybinds.
  -- ref: https://github.com/folke/which-key.nvim
  {
    'folke/which-key.nvim',
    name = 'which-key',
    event = 'VeryLazy',
    config = function()
      local which_key = require 'which-key'

      which_key.setup {
        icons = {
          breadcrumb = '»', -- symbol used in the command line area that shows your active key combo
          separator = '>', -- symbol used between a key and it's label
          group = '+', -- symbol prepended to a group
        },
      }

      -- Document existing key chains
      -- see: https://github.com/folke/which-key.nvim?tab=readme-ov-file#-setup
      which_key.register {
        ['<C-,>'] = { name = 'Nvim Settings', _ = 'which_key_ignore' },
        ['<C-t>'] = { name = 'Tab', _ = 'which_key_ignore' },
        ['<C-w>'] = { name = 'Window', _ = 'which_key_ignore' },

        ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },
        ['<leader>g'] = { name = 'Git', _ = 'which_key_ignore' },
        ['<leader>gh'] = { name = 'Git Hunk', _ = 'which_key_ignore' },
        ['<leader>l'] = { name = 'LSP', _ = 'which_key_ignore' },

        ['['] = { name = 'Previous', _ = 'which_key_ignore' },
        [']'] = { name = 'Next', _ = 'which_key_ignore' },
      }

      which_key.register({
        ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },
        ['<leader>g'] = { name = 'Git', _ = 'which_key_ignore' },
        ['<leader>gh'] = { name = 'Git Hunk', _ = 'which_key_ignore' },

        ['['] = { name = 'Previous', _ = 'which_key_ignore' },
        [']'] = { name = 'Next', _ = 'which_key_ignore' },
      }, { mode = 'x' })

      which_key.register({
        ['<leader>'] = { name = 'Special', _ = 'which_key_ignore' },

        ['['] = { name = 'Previous', _ = 'which_key_ignore' },
        [']'] = { name = 'Next', _ = 'which_key_ignore' },
      }, { mode = 'o' })
    end,
  },

  {
    'petertriho/nvim-scrollbar',
    name = 'scrollbar',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local colors = require('tokyonight.colors').setup()

      require('scrollbar').setup {
        -- excluded_buftypes = {
        --   'terminal',
        -- },

        excluded_filetypes = {
          -- default values
          'cmp_docs',
          'cmp_menu',
          'noice',
          'prompt',
          'TelescopePrompt',
          '',

          -- custom values
          'DiffviewFileHistory',
          'DiffviewFiles',
          'DressingInput',
          'Navbuddy',
          'NvimTree',
        },

        handle = {
          blend = 10, -- 0 for fully opaque and 100 to full transparent
        },

        marks = {
          Search = { color = colors.orange },
          Error = { color = colors.error },
          Warn = { color = colors.warning },
          Info = { color = colors.info },
          Hint = { color = colors.hint },
          Misc = { color = colors.purple },
        },
      }
    end,
  },

  {
    'kevinhwang91/nvim-hlslens',
    name = 'hlslens',
    keys = { '/', '?' },
    config = function()
      require('scrollbar.handlers.search').setup {
        virt_priority = 100,
      }

      local opts = { noremap = true, silent = true }

      opts.desc = 'Jump to the next match'
      vim.api.nvim_set_keymap('n', 'n', [[<Cmd>execute('normal! ' . v:count1 . 'n')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the previous match'
      vim.api.nvim_set_keymap('n', 'N', [[<Cmd>execute('normal! ' . v:count1 . 'N')<CR><Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the next match under cursor'
      vim.api.nvim_set_keymap('n', '*', [[*<Cmd>lua require('hlslens').start()<CR>]], opts)

      opts.desc = 'Jump to the previous match under cursor'
      vim.api.nvim_set_keymap('n', '#', [[#<Cmd>lua require('hlslens').start()<CR>]], opts)

      -- vim.api.nvim_set_keymap('n', 'g*', [[g*<Cmd>lua require('hlslens').start()<CR>]], opts)
      -- vim.api.nvim_set_keymap('n', 'g#', [[g#<Cmd>lua require('hlslens').start()<CR>]], opts)
    end,
  },

  -- context sticky scroll
  -- ref: https://github.com/nvim-treesitter/nvim-treesitter-context
  {
    'nvim-treesitter/nvim-treesitter-context',
    name = 'treesitter-context',
    event = { 'BufReadPre', 'BufNewFile' },
    opts = {
      enable = true,
      -- max_lines = 3,           -- How many lines the window should span. Values <= 0 mean no limit.
      multiline_threshold = 1, -- Maximum number of lines to show for a single context
    },
    config = function(_, opts)
      local ts_context = require 'treesitter-context'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      ts_context.setup(opts)

      local _, ctx_upward = ts_repeat_move.make_repeatable_move_pair(function() end, function() ts_context.go_to_context(vim.v.count1) end)

      vim.keymap.set('n', '[C', ctx_upward, { desc = 'Treesitter: Parent Context' })
    end,
  },

  -- Enable super zen mode by dims inactive portions of the code 👍🏻
  -- ref: https://github.com/folke/twilight.nvim
  {
    'folke/twilight.nvim',
    name = 'twilight',
    keys = {
      { '<leader>z', '<cmd>Twilight<CR>', desc = 'Zenmode: Toggle 🧘' },
    },
    config = function()
      require('twilight').setup {
        dimming = {
          -- when true, other windows will be fully dimmed (unless they contain the same buffer)
          inactive = false,
        },

        -- amount of lines we will try to show around the current line
        context = 10,
      }
    end,
  },

  -- TODO: fix statuscol disappear after update plugins by utilizing lazy's life cycle events
  --       ref: https://lazy.folke.io/usage#-user-events

  -- 'statuscolumn' made EASY(?)
  -- ref: https://github.com/luukvbaal/statuscol.nvim
  {
    'luukvbaal/statuscol.nvim',
    name = 'statuscol',
    event = 'VimEnter',
    config = function()
      local statuscol = require 'statuscol'
      local builtin = require 'statuscol.builtin'

      statuscol.setup {
        -- whether to right-align the cursor line number with 'relativenumber' set
        relculright = false,

        -- buftype' values for which 'statuscolumn' will be unset
        bt_ignore = { 'help' },

        segments = {
          { text = { '%s' }, click = 'v:lua.ScSa' },
          { text = { builtin.lnumfunc, ' ' }, click = 'v:lua.ScLa' },
          { text = { builtin.foldfunc, ' ' }, click = 'v:lua.ScFa' },
        },
      }
    end,
  },

  -- Make Nvim's fold look much prettier & modern
  -- ref: https://github.com/kevinhwang91/nvim-ufo
  {
    'kevinhwang91/nvim-ufo',
    name = 'ufo',
    event = 'LspAttach', -- Important! otherwise it won't work
    dependencies = { 'promise-async' },
    opts = {
      fold_virt_text_handler = ufo_utils.folded_number_suffix,
    },
    init = function()
      vim.opt.fillchars = {
        eob = ' ',
        fold = ' ',
        foldsep = ' ',
        foldopen = '',
        foldclose = '',
      }
    end,
    config = function(_, opts)
      local ufo = require 'ufo'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      ufo.setup(opts)

      -- must reload `statuscol` because this plugin overwrites its value
      ---@diagnostic disable-next-line: param-type-mismatch
      pcall(vim.cmd, [[silent Lazy reload statuscol]])

      local next_closed_fold, prev_closed_fold = ts_repeat_move.make_repeatable_move_pair(ufo.goNextClosedFold, ufo.goPreviousClosedFold)

      vim.keymap.set('n', ']z', next_closed_fold, { desc = 'UFO: Fold Region' })
      vim.keymap.set('n', '[z', prev_closed_fold, { desc = 'UFO: Fold Region' })

      -- vim.keymap.set('n', 'K', function()
      --   local fold_preview_win = ufo.peekFoldedLinesUnderCursor()
      --   if not fold_preview_win then vim.lsp.buf.hover() end
      -- end, { desc = 'Hover Documentation / Preview Folded Lines' })
    end,
  },

  {
    url = 'https://gitlab.com/HiPhish/rainbow-delimiters.nvim.git',
    name = 'rainbow-delimiters',
    config = function()
      require('rainbow-delimiters.setup').setup {
        priority = {
          -- default highlighting priority for this plugin.
          -- set this to a low-value if you only want to highlight
          -- just the visual indent guides
          [''] = 10,
        },
      }
    end,
  },

  {
    'lukas-reineke/indent-blankline.nvim',
    name = 'indent-blankline',
    event = { 'BufReadPost', 'BufNewFile' },
    dependencies = { 'rainbow-delimiters' },
    main = 'ibl',
    config = function()
      local ibl = require 'ibl'
      local hooks = require 'ibl.hooks'
      local colors = require('tokyonight.colors').setup()

      local custom_highlight = {
        { hl = 'RainbowDelimiterRed', fg = colors.red },
        { hl = 'RainbowDelimiterYellow', fg = colors.yellow },
        { hl = 'RainbowDelimiterBlue', fg = colors.blue },
        { hl = 'RainbowDelimiterOrange', fg = colors.orange },
        { hl = 'RainbowDelimiterGreen', fg = colors.green },
        { hl = 'RainbowDelimiterViolet', fg = colors.purple },
        { hl = 'RainbowDelimiterCyan', fg = colors.cyan },
      }

      local hls = vim.tbl_map(function(chl) return chl.hl end, custom_highlight)

      -- create the highlight groups in the highlight setup hook, so they are reset
      -- every time the colorscheme changes
      hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
        for _, chl in ipairs(custom_highlight) do
          vim.api.nvim_set_hl(0, chl.hl, { fg = chl.fg })
        end
      end)

      -- This is to be used to get a reliable sync with 'rainbow-delimiters' plugin
      hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)

      ibl.setup {
        indent = {
          -- priority = 1, -- indent char virt-text priority

          char = '▏',
          -- char = '│',
          -- char = '┊',
        },

        scope = {
          -- priority = 1024, -- scope char virt-text priority

          show_start = false, -- show underline at the start of scope
          show_end = false, -- show underline at the end of scope

          highlight = hls, -- set highlight group for scope char
        },

        exclude = {
          filetypes = {
            -- 'lspinfo',
            -- 'packer',
            -- 'checkhealth',
            -- 'help',
            -- 'man',
            -- 'gitcommit',
            -- 'TelescopePrompt',
            -- 'TelescopeResults',
            -- '',
          },

          buftypes = {
            -- 'terminal',
            -- 'nofile',
            -- 'quickfix',
            -- 'prompt',
          },
        },
      }
    end,
  },

  {
    'folke/trouble.nvim',
    name = 'trouble',
    cmd = 'Trouble',
    keys = {
      { '<leader>d', trouble_utils.show_panel 'diag', desc = 'Trouble: Show Diagnostics' },
      { '<leader>D', '<cmd>Trouble diag close<CR>', desc = 'Trouble: Hide Diagnostics' },

      { '<leader>q', trouble_utils.show_panel 'qf', desc = 'Trouble: Show Quickfix List' },
      { '<leader>Q', '<cmd>Trouble qf close<CR>', desc = 'Trouble: Hide Quickfix List' },

      { '<leader>.', trouble_utils.show_panel 'll', desc = 'Trouble: Show Location List' },
      { '<leader>>', '<cmd>Trouble ll close<CR>', desc = 'Trouble: Hide Location List' },

      { '<leader>t', trouble_utils.show_panel 'todolist', desc = 'Trouble: Show Todo List' },
      { '<leader>T', '<cmd>Trouble todolist close<CR>', desc = 'Trouble: Hide Todo List' },
    },
    dependencies = { 'lspconfig', 'web-devicons', 'todo-comments' },
    opts = {
      -- show a warning when there are no results
      warn_no_results = false,

      -- user-defined modes
      modes = {
        diag = {
          mode = 'diagnostics',
          preview = trouble_utils.split_preview,
        },

        qf = {
          mode = 'quickfix',
          preview = trouble_utils.split_preview,
        },

        ll = {
          mode = 'loclist',
          preview = trouble_utils.split_preview,
        },

        todolist = {
          mode = 'todo',
          preview = trouble_utils.split_preview,
          filter = { tag = { 'TODO', 'FIX', 'FIXME' } },
        },
      },
    },
    init = function() require 'lazy-nvim.lib.trouble-autocmd' end,
  },

  {
    'folke/todo-comments.nvim',
    name = 'todo-comments',
    event = 'VeryLazy',
    cmd = { 'TodoQuickFix', 'TodoLocList', 'TodoTelescope' },
    dependencies = { 'plenary', 'trouble', 'telescope' },
    opts = {
      highlight = {
        -- lua pattern to match the next multiline from the start of the matched keyword
        multiline_pattern = '^%s+',
      },
    },
    config = function(_, opts)
      local todo_comments = require 'todo-comments'
      local ts_repeat_move = require 'nvim-treesitter.textobjects.repeatable_move'

      todo_comments.setup(opts)

      local next_todo, prev_todo = ts_repeat_move.make_repeatable_move_pair(todo_comments.jump_next, todo_comments.jump_prev)

      vim.keymap.set('n', ']t', next_todo, { desc = 'Todo: Comment' })
      vim.keymap.set('n', '[t', prev_todo, { desc = 'Todo: Comment' })
    end,
  },

  {
    'nvim-lualine/lualine.nvim',
    name = 'lualine',
    event = 'VimEnter',
    dependencies = { 'web-devicons' },
    opts = {
      options = {
        -- set `true` to have a single statusline at bottom of instead of one for every window
        globalstatus = false,

        -- sets how often lualine should refresh it's contents (in ms)
        refresh = {
          statusline = 250,
          tabline = 250,
          winbar = 250,
        },

        disabled_filetypes = {
          winbar = { 'NvimTree', 'DiffviewFiles', 'DiffviewFileHistory', 'trouble' },
          statusline = { 'NvimTree', 'DiffviewFiles', 'DiffviewFileHistory', 'trouble' },
        },

        -- which filetypes to always be drawn as inactive statusline
        -- ignore_focus = { 'help' },
      },

      extensions = {},

      tabline = {},

      winbar = {
        lualine_a = {},
        lualine_b = { unpack(lualine_utils.filetype_with_icon()) },
        lualine_c = { lualine_utils.navic },
        lualine_x = {},
        lualine_y = { lualine_utils.diagnostics },
        lualine_z = {},
      },
      inactive_winbar = {
        lualine_a = {},
        lualine_b = { unpack(lualine_utils.filetype_with_icon(true)) },
        lualine_c = {},
        lualine_x = {},
        lualine_y = { lualine_utils.diagnostics },
        lualine_z = {},
      },

      sections = {
        lualine_a = { 'mode', lualine_utils.macro_recording },
        lualine_b = { lualine_utils.branch },
        lualine_c = { lualine_utils.blame_line },
        lualine_x = { 'encoding', 'fileformat' },
        lualine_y = { lualine_utils.filetype },
        lualine_z = { 'searchcount', 'selectioncount', 'location' },
      },
      inactive_sections = {
        lualine_a = {},
        lualine_b = { lualine_utils.branch },
        lualine_c = { lualine_utils.blame_line },
        lualine_x = {},
        lualine_y = { lualine_utils.filetype },
        lualine_z = { 'location' },
      },
    },
  },

  {
    'SmiteshP/nvim-navic',
    name = 'lualine.navic',
    dependencies = { 'lspconfig' },
    opts = {
      lsp = { auto_attach = true },
    },
    config = function(_, opts) require('nvim-navic').setup(opts) end,
  },

  {
    'SmiteshP/nvim-navbuddy',
    name = 'navbuddy',
    keys = {
      { '<leader>n', '<cmd>lua require("nvim-navbuddy").open()<CR>', desc = 'NavBuddy: Open Popup' },
    },
    dependencies = { 'lspconfig', 'lualine.navic', 'nui', 'comment', 'telescope' },
    opts = {
      lsp = { auto_attach = true },

      window = {
        border = 'rounded', -- "single", "rounded", "double", "solid", "none"

        -- Or table format example: { height = "40%", width = "100%" }
        -- ref: https://github.com/MunifTanjim/nui.nvim/tree/main/lua/nui/layout#size
        size = { width = '60%', height = 37 },

        -- Or table format example: { row = "100%", col = "0%" }
        -- ref: https://github.com/MunifTanjim/nui.nvim/tree/main/lua/nui/layout#position
        position = { row = '50%', col = '50%' },

        sections = {
          left = { size = '25%' },
          mid = { size = '25%' },
          right = { preview = 'always' }, -- "leaf", "always" or "never"
        },
      },

      node_markers = {
        icons = {
          leaf_selected = '',
          branch = '  ',
        },
      },

      source_buffer = {
        reorient = 'smart', -- "smart", "top", "mid" or "none"
      },
    },
    config = function(_, opts)
      local navbuddy = require 'nvim-navbuddy'
      local actions = require 'nvim-navbuddy.actions'

      opts.use_default_mappings = false
      opts.mappings = {
        ['?'] = actions.help(),
        ['<esc>'] = actions.close(),
        ['q'] = actions.close(),

        ['<enter>'] = actions.select(),
        ['o'] = actions.select(),
        ['<C-s>'] = actions.hsplit(),
        ['<C-v>'] = actions.vsplit(),

        ['<Left>'] = actions.parent(),
        ['<Right>'] = actions.children(),

        ['h'] = actions.parent(),
        ['j'] = actions.next_sibling(),
        ['k'] = actions.previous_sibling(),
        ['l'] = actions.children(),

        ['0'] = actions.root(),

        ['v'] = actions.visual_name(),
        ['V'] = actions.visual_scope(),

        ['y'] = actions.yank_name(),
        ['Y'] = actions.yank_scope(),

        ['i'] = actions.insert_name(),
        ['I'] = actions.insert_scope(),

        ['a'] = actions.append_name(),
        ['A'] = actions.append_scope(),

        ['r'] = actions.rename(),
        ['d'] = actions.delete(),

        ['z'] = actions.fold_create(),
        ['Z'] = actions.fold_delete(),

        ['c'] = actions.comment(),

        ['J'] = actions.move_down(),
        ['K'] = actions.move_up(),

        ['p'] = actions.toggle_preview(),
        ['f'] = actions.telescope {},
      }

      navbuddy.setup(opts)
    end,
  },

  {
    'nanozuki/tabby.nvim',
    name = 'tabby',
    event = 'VimEnter',
    keys = {
      { '<C-t>r', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },
      { '<C-t><C-r>', ':Tabby rename_tab ', desc = 'Tab: Rename Current' },

      -- TODO: create a new telescope picker for this one to replace `builtin.buffers`
      --       or wait until https://github.com/nanozuki/tabby.nvim/issues/143 is finished
      --       ref: https://github.com/nanozuki/tabby.nvim/blob/main/lua/tabby/feature/win_picker.lua#L16
      { '<C-t>p', '<cmd>Tabby pick_window<CR>', desc = 'Tab: Pick Window' },
      { '<C-t><C-p>', '<cmd>Tabby pick_window<CR>', desc = 'Tab: Pick Window' },
    },
    dependencies = { 'web-devicons' },
    config = function()
      local theme = tabby_utils.setup_theme 'auto'

      require('tabby').setup {
        line = tabby_utils.custom_tabline(theme),
        option = { buf_name = { mode = 'unique' } },
      }
    end,
  },

  {
    'rcarriga/nvim-notify',
    name = 'notify',
    event = 'VeryLazy',
    opts = {
      -- 'default', 'minimal', 'simple', 'compact', 'wrapped-compact'
      -- ref: https://github.com/rcarriga/nvim-notify?tab=readme-ov-file#render-style
      render = 'default',

      -- 'fade_in_slide_out', 'fade', 'slide', 'static'
      -- ref: https://github.com/rcarriga/nvim-notify?tab=readme-ov-file#animation-style
      stages = 'fade_in_slide_out',

      timeout = 3000,
      top_down = true,

      minimum_width = 30,
      max_width = 60, -- `(number|function)` Max number of columns for messages
      -- max_height = nil, -- `(number|function)` Max number of lines for a message
    },
  },

  {
    'folke/noice.nvim',
    -- name = 'noice', -- had to commment this due to some bug occured
    event = 'VeryLazy',
    dependencies = { 'nui', 'notify', 'nvim-treesitter' },
    opts = {
      messages = {
        view_search = false, -- use `hlslens` instead
      },

      lsp = {
        -- override markdown rendering so that **cmp** and other plugins use **Treesitter**
        override = {
          ['vim.lsp.util.convert_input_to_markdown_lines'] = true,
          ['vim.lsp.util.stylize_markdown'] = true,
          ['cmp.entry.get_documentation'] = true, -- requires hrsh7th/nvim-cmp
        },

        hover = {
          silent = true, -- set to true to not show a message if hover is not available
        },

        documentation = {
          opts = {
            size = { max_width = 60, max_height = 20 },
          },
        },
      },

      presets = {
        lsp_doc_border = true, -- add a border to hover docs and signature help
      },

      routes = {
        noice_utils.skip_annoying_messages,
        -- noice_utils.skip_luals_progress_messages,
      },

      format = {
        lsp_progress_done = {
          { '✓ ', hl_group = 'NoiceLspProgressSpinner' },
          { '{data.progress.title} ', hl_group = 'NoiceLspProgressTitle' },
          { '{data.progress.client} ', hl_group = 'NoiceLspProgressClient' },
        },
      },
    },
  },

  {
    'stevearc/dressing.nvim',
    event = 'VeryLazy',
    opts = {
      input = {
        mappings = {
          i = {
            ['<C-c>'] = false, -- press this key to exit insert mode instead
            ['<Esc>'] = 'Close',
          },
        },
      },

      select = {
        -- Options for telescope selector
        -- These are passed into the telescope picker directly. Can be used like:
        -- telescope = require('telescope.themes').get_ivy({...})
        telescope = nil,
      },
    },
  },
}
