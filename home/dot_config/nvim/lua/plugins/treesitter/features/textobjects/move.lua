return {
  enable = true,

  -- whether to set jumps in the jumplist
  set_jumps = true,

  goto_next_start = {
    [']a'] = { query = '@parameter.inner', desc = 'Treesitter: Argument Start' },
    [']m'] = { query = '@function.outer', desc = 'Treesitter: Method Start' },
    [']f'] = { query = '@function.outer', desc = 'Treesitter: Function Start' },
    [']l'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment Start' },
    [']r'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment Start' },
    [']='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment Start' },
    [']x'] = { query = '@call.outer', desc = 'Treesitter: Function Call Start' },
    [']i'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement Start' },
    [']o'] = { query = '@loop.outer', desc = 'Treesitter: Loop Start' },
    [']e'] = { query = '@return.outer', desc = 'Treesitter: Return Statement Start' },
  },

  goto_next_end = {
    [']A'] = { query = '@parameter.inner', desc = 'Treesitter: Argument End' },
    [']M'] = { query = '@function.outer', desc = 'Treesitter: Method End' },
    [']F'] = { query = '@function.outer', desc = 'Treesitter: Function End' },
    [']L'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment End' },
    [']R'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment End' },
    [']+'] = { query = '@assignment.outer', desc = 'Treesitter: Assignment End' },
    [']X'] = { query = '@call.outer', desc = 'Treesitter: Function Call End' },
    [']I'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement End' },
    [']O'] = { query = '@loop.outer', desc = 'Treesitter: Loop End' },
    [']E'] = { query = '@return.outer', desc = 'Treesitter: Return Statement End' },
  },

  goto_previous_start = {
    ['[a'] = { query = '@parameter.inner', desc = 'Treesitter: Argument Start' },
    ['[m'] = { query = '@function.outer', desc = 'Treesitter: Method Start' },
    ['[f'] = { query = '@function.outer', desc = 'Treesitter: Function Start' },
    ['[l'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment Start' },
    ['[r'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment Start' },
    ['[='] = { query = '@assignment.outer', desc = 'Treesitter: Assignment Start' },
    ['[x'] = { query = '@call.outer', desc = 'Treesitter: Function Call Start' },
    ['[i'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement Start' },
    ['[o'] = { query = '@loop.outer', desc = 'Treesitter: Loop Start' },
    ['[e'] = { query = '@return.outer', desc = 'Treesitter: Return Statement Start' },
  },

  goto_previous_end = {
    ['[A'] = { query = '@parameter.inner', desc = 'Treesitter: Argument End' },
    ['[M'] = { query = '@function.outer', desc = 'Treesitter: Method End' },
    ['[F'] = { query = '@function.outer', desc = 'Treesitter: Function End' },
    ['[L'] = { query = '@assignment.lhs', desc = 'Treesitter: Left Assignment End' },
    ['[R'] = { query = '@assignment.rhs', desc = 'Treesitter: Right Assignment End' },
    ['[+'] = { query = '@assignment.outer', desc = 'Treesitter: Assignment End' },
    ['[X'] = { query = '@call.outer', desc = 'Treesitter: Function Call End' },
    ['[I'] = { query = '@conditional.outer', desc = 'Treesitter: If Statement End' },
    ['[O'] = { query = '@loop.outer', desc = 'Treesitter: Loop End' },
    ['[E'] = { query = '@return.outer', desc = 'Treesitter: Return Statement End' },
  },
}
