def custom-keybindings [] {
  [
    # alt+h -> open_help_menu
    {
      name: open_help_menu
      modifier: alt
      keycode: char_h
      mode: [emacs vi_insert vi_normal]
      event: { send: Menu, name: help_menu }
    }

    # alt+j -> enter
    {
      name: enter
      modifier: alt
      keycode: char_j
      mode: [emacs vi_insert vi_normal]
      event: { send: Enter }
    }

    # alt+k -> kill_line
    {
      name: kill_line
      modifier: alt
      keycode: char_k
      mode: [emacs vi_insert vi_normal]
      event: { edit: KillLine }
    }

    # alt+l -> clear_screen
    {
      name: clear_screen
      modifier: alt
      keycode: char_l
      mode: [emacs vi_insert vi_normal]
      event: { send: ClearScreen }
    }

    # ctrl+shift+c -> copy_selection
    {
      name: copy_selection
      modifier: control_shift
      keycode: char_c
      mode: [emacs vi_insert vi_normal]
      event: { edit: CopySelection }
    }

    # alt+right -> complete_word_or_word_right
    {
      name: complete_word_or_word_right
      modifier: alt
      keycode: right
      mode: [emacs vi_insert vi_normal]
      event: {
        until: [
          { send: HistoryHintWordComplete }
          { edit: MoveWordRightStart }
        ]
      }
    }

    # alt+shift+right -> select_word_right
    {
      name: select_word_right
      modifier: alt_shift
      keycode: right
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveWordRight select: true }
    }

    # alt+left -> word_left
    {
      name: word_left
      modifier: alt
      keycode: left
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveWordLeft }
    }

    # alt+shift+left -> select_word_left
    {
      name: select_word_left
      modifier: alt_shift
      keycode: left
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveWordLeft select: true }
    }

    # ctrl+right -> complete_hint_or_line_end
    {
      name: complete_hint_or_line_end
      modifier: control
      keycode: right
      mode: [emacs vi_insert vi_normal]
      event: {
        until: [
          { send: HistoryHintComplete }
          { edit: MoveToLineEnd }
        ]
      }
    }

    # ctrl+shift+right -> select_line_end
    {
      name: select_line_end
      modifier: control_shift
      keycode: right
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveToLineEnd select: true }
    }

    # ctrl+left -> line_start
    {
      name: line_start
      modifier: control
      keycode: left
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveToLineStart }
    }

    # ctrl+shift+left -> select_line_start
    {
      name: select_line_start
      modifier: control_shift
      keycode: left
      mode: [emacs vi_insert vi_normal]
      event: { edit: MoveToLineStart select: true }
    }

    # right -> menu_right_or_right
    {
      name: menu_right_or_right
      modifier: none
      keycode: right
      mode: [emacs vi_insert vi_normal]
      event: {
        until: [
          { send: MenuRight }
          { send: Right }
        ]
      }
    }

    # left -> menu_left_or_left
    {
      name: menu_left_or_left
      modifier: none
      keycode: left
      mode: [emacs vi_insert vi_normal]
      event: {
        until: [
          { send: MenuLeft }
          { send: Left }
        ]
      }
    }

    # ctrl+t -> fuzzy_search_paths
    {
      name: fuzzy_search_paths
      modifier: control
      keycode: char_t
      mode: [emacs vi_insert vi_normal]
      event: {
        send: ExecuteHostCommand
        cmd: $"commandline edit --insert \(($env.FZF_CTRL_T_COMMAND) | fzf ($env.FZF_CTRL_T_OPTS) | fzf-join\)"
      }
    }

    # ctrl+r -> fuzzy_search_history
    {
      name: fuzzy_search_history
      modifier: control
      keycode: char_r
      mode: [emacs vi_insert vi_normal]
      event: {
        send: ExecuteHostCommand
        cmd: $"commandline edit --replace \(($env.FZF_CTRL_R_COMMAND) | fzf ($env.FZF_CTRL_R_OPTS)\)"
      }
    }

    # alt+c -> fuzzy_change_dir
    {
      name: fuzzy_change_dir
      modifier: alt
      keycode: char_c
      mode: [emacs vi_insert vi_normal]
      event: {
        send: ExecuteHostCommand
        cmd: $"cd \(($env.FZF_ALT_C_COMMAND) | fzf ($env.FZF_ALT_C_OPTS)\) | commandline edit --replace ''"
      }
    }

    # alt+shift+c -> fuzzy_change_dir_zoxide
    {
      name: fuzzy_change_dir_zoxide
      modifier: alt_shift
      keycode: char_c
      mode: [emacs vi_insert vi_normal]
      event: {
        send: ExecuteHostCommand
        cmd: "__zoxide_zi (commandline) | commandline edit --replace ''"
      }
    }

    # alt+t -> fuzzy_ls_current_dir
    {
      name: fuzzy_ls_current_dir
      modifier: alt
      keycode: char_t
      mode: [emacs vi_insert vi_normal]
      event: {
        send: ExecuteHostCommand
        cmd: "commandline edit --insert (fuzzy ls)"
      }
    }
  ]
}
