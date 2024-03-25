# screenshots for themes
# ref: https://github.com/nushell/nu_scripts/blob/main/themes/screenshots/README.md
use nu_scripts/themes/nu-themes/monokai-soda.nu

$env.config = ($env.config | merge {color_config: (monokai-soda)})
