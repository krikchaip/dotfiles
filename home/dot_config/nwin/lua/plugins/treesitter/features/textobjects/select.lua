return {
  enable = true,

  -- Automatically jump forward to textobj, similar to targets.vim
  -- lookahead = true,

  keymaps = {
    ['aa'] = { query = '@parameter.outer', desc = 'Treesitter: Argument' },
    ['am'] = { query = '@function.outer', desc = 'Treesitter: Method' },
    ['af'] = { query = '@function.outer', desc = 'Treesitter: Function' },
    ['al'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment' },
    ['ar'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment' },
    ['a='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment' },
    ['ax'] = { query = '@call.outer', desc = 'Treesitter: Function Call' },
    ['ai'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement' },
    ['ao'] = { query = '@loop.outer', desc = 'Treesitter: Loop' },
    ['ae'] = { query = '@return.outer', desc = 'Treesitter: Return Statement' },

    ['ia'] = { query = '@parameter.inner', desc = 'Treesitter: Argument' },
    ['im'] = { query = '@function.inner', desc = 'Treesitter: Method' },
    ['if'] = { query = '@function.inner', desc = 'Treesitter: Function' },
    ['il'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment' },
    ['ir'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment' },
    ['i='] = { query = '@assignment.inner', desc = 'Treesitter: Assignment' },
    ['ix'] = { query = '@call.inner', desc = 'Treesitter: Function Call' },
    ['ii'] = { query = '@conditional.inner', desc = 'Treesitter: If Statement' },
    ['io'] = { query = '@loop.inner', desc = 'Treesitter: Loop' },
    ['ie'] = { query = '@return.inner', desc = 'Treesitter: Return Statement' },
  },
}
