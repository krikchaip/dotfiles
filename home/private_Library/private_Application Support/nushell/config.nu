$env.config = {
  buffer_editor: nvim
  edit_mode: vi
  shell_integration: true
  show_banner: false
}

# custom-defined aliases, functions and etc.
source custom/aliases.nu
source custom/completions.nu
source custom/functions.nu
source custom/themes.nu

# setup 3rd-party integration
source vendor/mise.nu
source vendor/starship.nu
