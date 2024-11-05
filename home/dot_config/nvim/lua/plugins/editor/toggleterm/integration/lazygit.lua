return function()
  local Terminal = require('toggleterm.terminal').Terminal

  return {
    default = Terminal:new {
      cmd = 'lazygit',
      display_name = '💤Lazygit',
      direction = 'float',

      hidden = true,

      on_open = function(term)
        local opts = { buffer = term.bufnr }

        local function close_lazygit()
          term:close()
        end

        opts.desc = 'Lazygit: Close Source Control'
        vim.keymap.set('t', '<C-g>', close_lazygit, opts)
        vim.keymap.set('t', '<C-c>', close_lazygit, opts)
      end,
    },
  }
end
