-- extended text objects (di*, da*, ci*, ca*, etc.)
-- ref: https://github.com/nvim-treesitter/nvim-treesitter-textobjects
return {
  -- Spec Source
  'nvim-treesitter/nvim-treesitter-textobjects',
  name = 'treesitter-textobjects',

  -- Spec Setup
  config = function()
    require('nvim-treesitter-textobjects').init()

    local actions = require 'nvim-treesitter.textobjects.repeatable_move'

    -- Repeat movement with ; and ,
    -- ensure ; goes forward and , goes backward regardless of the last direction
    vim.keymap.set({ 'n', 'x', 'o' }, ';', actions.repeat_last_move_next, { desc = 'Repeat last move next' })
    vim.keymap.set({ 'n', 'x', 'o' }, ',', actions.repeat_last_move_previous, { desc = 'Repeat last move previous' })

    -- vim way: ; goes to the direction you were moving.
    -- vim.keymap.set({ 'n', 'x', 'o' }, ';', actions.repeat_last_move, { desc = 'Repeat last move' })
    -- vim.keymap.set({ 'n', 'x', 'o' }, ',', actions.repeat_last_move_opposite, { desc = 'Repeat last move opposite' })

    -- Optionally, make builtin f, F, t, T also repeatable with ; and ,
    vim.keymap.set({ 'n', 'x', 'o' }, 'f', actions.builtin_f_expr, { expr = true })
    vim.keymap.set({ 'n', 'x', 'o' }, 'F', actions.builtin_F_expr, { expr = true })
    vim.keymap.set({ 'n', 'x', 'o' }, 't', actions.builtin_t_expr, { expr = true })
    vim.keymap.set({ 'n', 'x', 'o' }, 'T', actions.builtin_T_expr, { expr = true })
  end,
}
