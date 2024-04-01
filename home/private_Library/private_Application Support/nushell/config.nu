# setup 3rd-party integration
use vendor/nu_scripts.nu *
use vendor/carapace.nu
use vendor/mise.nu
use vendor/starship.nu

# custom-defined aliases, functions and etc.
source custom/aliases.nu
source custom/functions.nu

$env.config = {
  buffer_editor: nvim
  edit_mode: vi
  shell_integration: true
  show_banner: false
  color_config: (monokai-soda)
  completions: {
    external: { enable: true, completer: (carapace) }
  }
  keybindings: [
    {
      name: open_help_menu
      modifier: control
      keycode: char_h
      mode: [emacs vi_insert]
      event: { send: menu, name: help_menu }
    }
    {
      name: complete_word_or_word_right
      modifier: alt
      keycode: right
      mode: [emacs vi_insert]
      event: {
        until: [
          { send: HistoryHintWordComplete }
          { edit: MoveWordRight }
        ]
      }
    }
    {
      name: word_left
      modifier: alt
      keycode: left
      mode: [emacs vi_insert]
      event: { edit: MoveWordLeft }
    }
    {
      name: complete_hint_or_end_of_line
      modifier: control
      keycode: right
      mode: [emacs vi_insert]
      event: {
        until: [
          { send: HistoryHintComplete }
          { edit: MoveToLineEnd }
        ]
      }
    }
    {
      name: line_start
      modifier: control
      keycode: left
      mode: [emacs vi_insert]
      event: { edit: MoveToLineStart }
    }
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
  ]
}
