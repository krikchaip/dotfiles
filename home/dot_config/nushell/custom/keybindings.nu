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
        cmd: $"commandline edit --insert \(
          fd --type file
             --type directory
             --type symlink
             --follow
             --hidden
             --strip-cwd-prefix
             --exclude '**/.git/*'
             --color always
          | fzf --ansi
                --multi
                --scheme path
                --keep-right
                --height 40%
                --layout reverse
                --margin 0,2
                --info inline-right
                --preview '~/.config/fzf/preview {}'
                --bind alt-d:preview-half-page-down,alt-u:preview-half-page-up
                --bind alt-f:preview-bottom,alt-b:preview-top
                --bind alt-j:preview-down,alt-k:preview-up
                --bind ctrl-d:half-page-down,ctrl-u:half-page-up
                --bind ctrl-f:last,ctrl-b:first
                --bind shift-down:toggle+down,shift-up:toggle+up
                --bind tab:toggle,shift-tab:ignore
          | lines
          | str join ' '
        \)"
      }
    }

    # ctrl+y -> change_dir_with_fzf
    # {
    #   name: change_dir_with_fzf
    #   modifier: control
    #   keycode: char_y
    #   mode: [emacs vi_insert vi_normal]
    #   event: {
    #     send: executehostcommand
    #     cmd: 'cd (ls | where type == dir | each { |it| $it.name} | str join (char nl) | fzf | decode utf-8 | str trim)'
    #   }
    # }
  ]
}
