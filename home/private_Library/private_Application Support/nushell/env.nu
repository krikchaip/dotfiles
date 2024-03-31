let path_list = (
  # the environment variables inherited from the host process are still strings,
  # so we need to convert them to nushell values before using
  $env.PATH
  | split row (char esep)

  # homebrew binaries for macOS on Intel
  | prepend /usr/local/bin

  # homebrew binaries for macOS on ARM64 (Apple Silicon)
  | prepend /opt/homebrew/sbin
  | prepend /opt/homebrew/bin

  # for chezmoi that was installed during initial installation
  | prepend ($env.HOME | path join ".local" "bin")
)

# filter so the paths are unique
$env.PATH = ($path_list | uniq)

# make source/use file-relative in env.nu and config.nu
# ref: https://github.com/nushell/nushell/issues/8127
#      https://www.nushell.sh/book/modules.html#dumping-files-into-directory
$env.NU_LIB_DIRS = [
  $nu.default-config-dir
]
