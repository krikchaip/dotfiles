export-env {
  load-env {
    FZF_DEFAULT_OPTS: (sanitize "
      --ansi
      --height=40%
      --info=inline-right
      --layout=reverse
      --margin=0,2

      --bind=alt-d:preview-half-page-down,alt-u:preview-half-page-up
      --bind=alt-f:preview-bottom,alt-b:preview-top
      --bind=alt-j:preview-down,alt-k:preview-up
      --bind=ctrl-d:half-page-down,ctrl-u:half-page-up
      --bind=ctrl-f:last,ctrl-b:first
      --bind=shift-down:toggle+down,shift-up:toggle+up
      --bind=tab:toggle,shift-tab:ignore
    ")

    FZF_CTRL_T_COMMAND: (sanitize "
      fd --color=always
         --exclude='**/.git/*'
         --follow
         --hidden
         --strip-cwd-prefix
         --type=directory
         --type=file
         --type=symlink
    ")

    FZF_CTRL_T_OPTS: (sanitize "
      --keep-right
      --multi
      --preview='~/.local/bin/fzf-preview {}'
      --scheme=path
    ")
  }
}

export def fzf-join []: string -> string {
  lines | str join ' '
}

def sanitize [opts: string] {
  $opts
    | lines
    | each {|it| $it | str trim }
    | where ($it | str length) > 0
    | str join ' '
}
