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

        opts.desc = 'Lazygit: Close Source Control'
        vim.keymap.set('t', '<C-g>', function()
          term:close()
        end, opts)
      end,
    },
  }
end
