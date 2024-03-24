let path_list = (
  # the environment variables inherited from the host process are still strings,
  # so we need to convert them to nushell values before using
  $env.PATH
  | split row (char esep)

  # homebrew binaries for macOS ARM64 (Apple Silicon)
  | append /opt/homebrew/bin

  # other binary locations
  | append /usr/local/bin
  | append ($env.HOME | path join ".local" "bin")

  # fix ERR_PNPM_NO_GLOBAL_BIN_DIR Unable to find the global bin directory.
  # ref: https://github.com/pnpm/pnpm/issues/4658
  | append ($env.HOME | path join "Library" "pnpm")
)

# filter so the paths are unique
$env.PATH = ($path_list | uniq)

# set asdf installation path installed via homebrew
$env.ASDF_DIR = (brew --prefix asdf | str trim | into string | path join 'libexec')

# make source/use file-relative in env.nu and config.nu
# ref: https://github.com/nushell/nushell/issues/8127
#      https://www.nushell.sh/book/modules.html#dumping-files-into-directory
$env.NU_LIB_DIRS = [
  $nu.default-config-dir
]
