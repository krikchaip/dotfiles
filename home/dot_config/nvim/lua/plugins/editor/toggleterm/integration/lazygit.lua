return function()
  local Terminal = require('toggleterm.terminal').Terminal

  --- @param term Terminal
  local function term_keybindings(term)
    local opts = { buffer = term.bufnr }

    local function close_lazygit()
      term:close()
    end

    opts.desc = 'Lazygit: Close Source Control'
    vim.keymap.set('t', '<C-g>', close_lazygit, opts)
    vim.keymap.set('t', '<C-c>', close_lazygit, opts)
  end

  --- @param cmd string
  --- @param on_open? fun(term: Terminal)
  local function base_term(cmd, on_open)
    return Terminal:new {
      cmd = cmd,
      display_name = '💤Lazygit',
      direction = 'float',

      hidden = true,

      on_open = function(term)
        if on_open then on_open(term) end
        term_keybindings(term)
      end,
    }
  end

  return {
    default = base_term 'lazygit',
    branch = base_term('lazygit branch', function()
      vim.api.nvim_feedkeys('_', 'i', false)
    end),
  }
end
