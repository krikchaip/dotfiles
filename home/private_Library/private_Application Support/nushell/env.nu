let path_list = (
  # the environment variables inherited from the host process are still strings,
  # so we need to convert them to nushell values before using
  $env.PATH
  | split row (char esep)

  # other system binaries locations
  | prepend /usr/local/bin
  | prepend ($env.HOME | path join ".local" "bin")

  # homebrew binaries for macOS ARM64 (Apple Silicon)
  | prepend /opt/homebrew/sbin
  | prepend /opt/homebrew/bin
)

# filter so the paths are unique
$env.PATH = ($path_list | uniq)

# change the default configuration file location for starship
$env.STARSHIP_CONFIG = ($env.HOME | path join ".config" "starship" "starship.toml")

# make source/use file-relative in env.nu and config.nu
# ref: https://github.com/nushell/nushell/issues/8127
#      https://www.nushell.sh/book/modules.html#dumping-files-into-directory
$env.NU_LIB_DIRS = [
  $nu.default-config-dir
]
