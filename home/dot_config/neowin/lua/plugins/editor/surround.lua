-- [[ Add Surround ]]
--   `ysiw)` - surr*ound_words         -> (surround_words)
--   `ysa")` - require"nvim-surroun*d" -> require("nvim-surround")
--   `ys$"`  - *make strings           -> "make strings"
--   `ysl'`  - char c = *x;            -> char c = 'x';
--   `yst;}` - int a[] = *32;          -> int a[] = {32};
--
-- [[ Delete Surround ]]
--   `ds]` - [delete ar*ound me!]     -> delete around me!
--   `dst` - remove <b>HTML t*ags</b> -> remove HTML tags
--   `dsf` - delete(functi*on calls)  -> function calls
--
-- [[ Change Surround ]]
--   `cs'"`      - 'change quot*es'     -> "change quotes"
--   `csth1<CR>` - <b>or tag* types</b> -> <h1>or tag types</h1>
--
-- [[ Aliases ]]
--   `b` - (Parentheses)
--   `B` - {Curly Brackets}
--   `r` - [Square Brackets]
--   `q` - `"'Quotes'"`
--   `a` - <Anchors>
--
-- Note: Tabular aliases cannot be used to add surrounding pairs,
-- e.g. `ysa)q` is invalid, since it's ambiguous which pair should be added.
return {
  -- Spec Source
  'kylechui/nvim-surround',
  name = 'surround',

  -- Spec Setup
  opts = {
    -- keep the cursor position after performing a surround action
    move_cursor = false,

    keymaps = {
      insert = '<C-g>',
      insert_line = '<C-Enter>',
    },
  },

  -- Spec Lazy Loading
  event = 'VeryLazy',

  -- Spec Versioning
  version = '*', -- use for stability; omit to use `main` branch for the latest features
}
