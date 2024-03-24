$env.config = {
  buffer_editor: nvim
  edit_mode: vi
  shell_integration: true
  show_banner: false
}

# custom-defined aliases and functions
source aliases.nu
# source functions.nu

# setup asdf integration, including auto completion
source /opt/homebrew/opt/asdf/libexec/asdf.nu
