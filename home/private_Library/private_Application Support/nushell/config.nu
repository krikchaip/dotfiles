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

# setup asdf integration, including auto completion
source /opt/homebrew/opt/asdf/libexec/asdf.nu
