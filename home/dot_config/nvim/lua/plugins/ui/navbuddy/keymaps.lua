local actions = require 'nvim-navbuddy.actions'

return {
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
