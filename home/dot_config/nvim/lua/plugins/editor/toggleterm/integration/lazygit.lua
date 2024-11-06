return function()
  local Terminal = require('toggleterm.terminal').Terminal

  --- @param term Terminal
  --- @param close_behavior? 'default' | 'terminate'
  local function term_keybindings(term, close_behavior)
    close_behavior = close_behavior or 'default'

    local opts = { buffer = term.bufnr }

    local function close_lazygit()
      if close_behavior == 'default' then
        term:close()
      elseif close_behavior == 'terminate' then
        term:send 'q'
      end
    end

    opts.desc = 'Lazygit: Close Source Control'
    vim.keymap.set('t', '<C-g>', close_lazygit, opts)
    vim.keymap.set('t', '<C-c>', close_lazygit, opts)
  end

  --- @param cmd string
  --- @param on_open? fun(term: Terminal)
  --- @param close_behavior? 'default' | 'terminate'
  local function base_term(cmd, on_open, close_behavior)
    return Terminal:new {
      cmd = cmd,
      display_name = '💤Lazygit',
      direction = 'float',

      hidden = true,

      on_open = function(term)
        if on_open then on_open(term) end
        term_keybindings(term, close_behavior)
      end,

      on_close = function()
        vim.cmd.edit()
      end,

      on_exit = function()
        vim.cmd.edit()
      end,
    }
  end

  return {
    default = base_term 'lazygit',
    branch = base_term('lazygit branch', function()
      vim.api.nvim_feedkeys('_', 'i', false)
    end),
    log = base_term('lazygit log', function()
      vim.api.nvim_feedkeys('_', 'i', false)
    end),
    file_history = base_term('lazygit log', function()
      vim.api.nvim_feedkeys('_', 'i', false)
    end, 'terminate'),
  }
end
