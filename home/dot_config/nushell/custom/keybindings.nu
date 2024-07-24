def custom-keybindings [] {
  [
    # ctrl+h -> open_help_menu
    {
      name: open_help_menu
      modifier: control
      keycode: char_h
      mode: [emacs vi_insert vi_normal]
      event: { send: Menu, name: help_menu }
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
  ]
}
