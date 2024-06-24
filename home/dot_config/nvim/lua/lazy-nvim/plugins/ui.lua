local lualine_utils = require 'lazy-nvim.lib.lualine-utils'
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
          'NvimTree',
          'DiffviewFiles',
          'DiffviewFileHistory',
          'Navbuddy',
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

  -- 'statuscolumn' made easy
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
      -- vim.cmd [[ silent Lazy reload statuscol ]]

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

      local custom_highlight = {
        { hl = 'RainbowDelimiterRed', fg = '#E06C75' },
        { hl = 'RainbowDelimiterYellow', fg = '#E5C07B' },
        { hl = 'RainbowDelimiterBlue', fg = '#61AFEF' },
        { hl = 'RainbowDelimiterOrange', fg = '#D19A66' },
        { hl = 'RainbowDelimiterGreen', fg = '#98C379' },
        { hl = 'RainbowDelimiterViolet', fg = '#C678DD' },
        { hl = 'RainbowDelimiterCyan', fg = '#56B6C2' },
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
        diag = { mode = 'diagnostics', preview = trouble_utils.split_preview },

        qf = { mode = 'quickfix', preview = trouble_utils.split_preview },

        ll = { mode = 'loclist', preview = trouble_utils.split_preview },

        todolist = { mode = 'todo', preview = trouble_utils.split_preview },
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
    'j-hui/fidget.nvim',
    name = 'fidget',
    tag = 'v1.4.5',
    event = 'VeryLazy',
    opts = {
      progress = {
        -- Ignore new tasks that don't contain a message
        ignore_empty_message = true,

        -- Icon shown when all LSP progress tasks are complete
        display = { done_icon = '✓' },
      },

      notification = {
        -- Automatically override vim.notify() with Fidget
        override_vim_notify = false,
      },
    },
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
        lualine_b = { unpack(lualine_utils.filetype_with_icon()) },
        lualine_c = {},
        lualine_x = {},
        lualine_y = { lualine_utils.diagnostics },
        lualine_z = {},
      },

      sections = {
        lualine_a = { 'mode' },
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
          branch = '  ',
        },
      },

      source_buffer = {
        reorient = 'mid', -- "smart", "top", "mid" or "none"
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
}
