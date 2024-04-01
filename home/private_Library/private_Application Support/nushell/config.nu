# setup 3rd-party integration
use vendor/nu_scripts.nu *
use vendor/carapace.nu
use vendor/mise.nu
use vendor/starship.nu

# custom-defined aliases, functions and etc.
source custom/aliases.nu
source custom/functions.nu
source custom/keybindings.nu

$env.config = {
  buffer_editor: nvim
  edit_mode: vi
  shell_integration: true
  show_banner: false
  color_config: (monokai-soda)
  completions: {
    external: { enable: true, completer: (carapace) }
  }
  keybindings: (custom-keybindings)
}
