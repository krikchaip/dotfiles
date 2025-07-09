# setup 3rd-party integration
source vendor/carapace.nu
use vendor/fzf.nu *
use vendor/mise.nu
use vendor/nu_scripts.nu *
use vendor/starship.nu
use vendor/zoxide.nu *
use vendor/yazi.nu *

# custom-defined aliases, functions and etc.
source custom/functions.nu
source custom/aliases.nu
source custom/keybindings.nu

$env.config.show_banner = false
$env.config.edit_mode = "emacs"
$env.config.buffer_editor = "nvim"
$env.config.color_config = tokyo-storm
$env.config.keybindings = custom-keybindings
$env.config.display_errors.termination_signal = false
