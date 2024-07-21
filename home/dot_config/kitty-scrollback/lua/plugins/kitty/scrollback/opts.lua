-- ref: https://github.com/mikesmithgh/kitty-scrollback.nvim#configuration-options

local global = {
  -- enabled/disabled all default keymaps
  keymaps_enabled = false,

  -- restore options that were modified while processing the scrollback buffer
  restore_options = true,

  -- options for paste window that sends commands to Kitty
  paste_window = {
    -- register used during yanks to paste window
    yank_register = '',

    -- If true, the yank_register copies content to the paste window.
    -- If false, disable yank to paste window
    yank_register_enabled = true,
  },

  -- Sets the mode for coloring the Visual highlight group in the scrollback buffer window.
  --   'darken' - uses a darkened version of the Normal highlight group to improve readability.
  --   'kitty' - uses the colors defined for selection_foreground and selection_background in your Kitty configuration.
  --   'nvim' - uses the default colors defined in the Visual highlight group.
  --   'reverse' - reverses the foreground and background colors of the visual selection.
  visual_selection_highlight_mode = 'nvim',
}

-- `kitty_get_text.extent`
--   'screen' - show all text currently on the screen
--   'all' - show all the screen+scrollback texts
--   'selection' - show the currently selected text
--   'first_cmd_output_on_screen' - show the output of the first command that was run in the window on screen
--   'last_cmd_output' - show the output of the last command that was run in the window
--   'last_visited_cmd_output' - show the first command output below the last scrolled position via scroll_to_prompt
--   'last_non_empty_output' - show the output from the last command run in the window that had some non empty output

local all = {
  kitty_get_text = {
    extent = 'all',
  },
}

local last_output = {
  kitty_get_text = {
    extent = 'last_cmd_output',
  },
}

return {
  global,
  all = all,
  last_output = last_output,
}
