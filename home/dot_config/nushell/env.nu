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

  # user-defined scripts / downloaded binaries
  | prepend ($env.HOME | path join ".local" "bin")

  # for global bun binaries
  | prepend ($env.HOME | path join ".bun" "bin")

  # for global pnpm binaries
  # ref: https://github.com/pnpm/pnpm/issues/4658
  | append ($env.HOME | path join "Library" "pnpm")
)

# filter so the paths are unique
$env.PATH = ($path_list | uniq)

# make source/use file-relative in env.nu and config.nu
# ref: https://github.com/nushell/nushell/issues/8127
#      https://www.nushell.sh/book/modules.html#dumping-files-into-directory
$env.NU_LIB_DIRS = [
  $nu.default-config-dir
]

# to fix the ERR_PNPM_NO_GLOBAL_BIN_DIR issue
# ref: https://github.com/pnpm/pnpm/issues/4658
$env.PNPM_HOME = ($env.HOME | path join "Library" "pnpm")

# homebrew installs imagemagick and its dependencies somewhere that
# image.nvim couldn't reach. we have to tell the plugin to find those libs from this path
# ref: https://github.com/3rd/image.nvim#installing-imagemagick
$env.DYLD_LIBRARY_PATH = (brew --prefix | path parse | path join "lib")

# fix OpenSSL library not found during compilation for Apple Silicon MacBooks
# ref: https://stackoverflow.com/questions/26288042/error-installing-psycopg2-library-not-found-for-lssl
$env.LDFLAGS = $"-L (brew --prefix openssl)/lib"
$env.CPPFLAGS = $"-I (brew --prefix openssl)/include"

# temporary fix for OSX 15.7.1 permission denied when accessing tmp dir
# ref: https://github.com/jesseduffield/lazygit/issues/4924
$env.TMPDIR = (getconf DARWIN_USER_TEMP_DIR)
