# setup 3rd-party integration
source vendor/mise.nu
source vendor/nu_scripts.nu
source vendor/starship.nu

# custom-defined aliases, functions and etc.
source custom/aliases.nu
source custom/functions.nu

$env.config = {
  buffer_editor: nvim
  edit_mode: vi
  shell_integration: true
  show_banner: false,
  color_config: (monokai-soda)
}
