# setup 3rd-party integration
use vendor/carapace.nu *
use vendor/fzf.nu *
use vendor/nu_scripts.nu *
use vendor/zoxide.nu *
use vendor/mise.nu
use vendor/starship.nu

# custom-defined aliases, functions and etc.
source custom/functions.nu
source custom/aliases.nu
source custom/keybindings.nu

$env.config = ($env.config? | default {} | merge {
  show_banner: false
  edit_mode: emacs
  buffer_editor: nvim
  color_config: (tokyo-storm)
  keybindings: (custom-keybindings)
  completions: { external: { enable: true, completer: (carapace) } }
  display_errors: { termination_signal: false }

  # until: https://www.nushell.sh/blog/2024-05-28-nushell_0_94_0.html#shell-integration-config-toc is fixed
  shell_integration: {
    osc2: true
    osc7: true
    osc8: true
    osc9_9: false
    osc133: true
    osc633: true
    reset_application_mode: true
  }
})
